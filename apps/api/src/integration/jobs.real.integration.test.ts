import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import Redis from "ioredis";
import { buildServer } from "../server";
import { PostgresEventStore } from "../../../../packages/event-store/src/postgresEventStore";
import { JobRepository } from "../jobs/jobRepo";
import { JobQueue } from "../jobs/queue";
import { Planner } from "../../../../packages/planner/src/planner";
import { AuditLogger } from "../../../../packages/audit/src";
import { PermissionEngine } from "../../../../packages/permissions/src";
import { processJobOnce } from "../../worker/src/processor";
import { randomUUID } from "crypto";

const dbUrl = process.env.ORION_DB_URL;
const redisUrl = process.env.ORION_REDIS_URL;
const skip = !dbUrl || !redisUrl;

describe.skipIf(skip)("integration: jobs real infra", () => {
  const tenantA = "tenant-int-a";
  const tenantB = "tenant-int-b";
  const decisionId = "dec-int-exec";
  const correlationId = "corr-int-exec";
  let pool: Pool;
  let redis: Redis;
  let store: PostgresEventStore;
  let repo: JobRepository;
  let queue: JobQueue;
  const workerId = "int-worker";

  beforeAll(async () => {
    pool = new Pool({ connectionString: dbUrl });
    redis = new Redis(redisUrl);
    store = new PostgresEventStore({ pool });
    repo = new JobRepository(pool);
    queue = new JobQueue(redis);
    // apply migrations and clean tables
    await import("../../scripts/migrate");
    await pool.query("DELETE FROM events");
    await pool.query("DELETE FROM jobs");
  });

  afterAll(async () => {
    await pool.end();
    await redis.quit();
  });

  const buildServerWithDeps = () =>
    buildServer({
      eventStore: store,
      jobRepo: repo,
      jobQueue: queue,
      envOverrides: {
        ORION_EVENTSTORE_ADAPTER: "postgres",
        ORION_DB_URL: dbUrl,
        ORION_REDIS_URL: redisUrl,
        ORION_DEV_AUTH_BYPASS: "true",
      },
    });

  it("processes a job end-to-end with Postgres + Redis", async () => {
    const audit = new AuditLogger(store);
    const perm = new PermissionEngine(store, audit, [{ domain: "tasks", action: "create", level: "allow" }]);
    const planner = new Planner({ eventStore: store, audit, permissions: perm });
    await planner.decide({
      intent: { type: "tasks.create", domain: "tasks", action: "create" },
      actor: { userId: "tester" },
      decisionId,
      correlationId,
      tenantId: tenantA,
    });

    const app = buildServerWithDeps();
    await app.ready();
    const execRes = await app.inject({
      method: "POST",
      url: `/decisions/${decisionId}/execute`,
      headers: { "x-tenant-id": tenantA },
    });
    expect(execRes.statusCode).toBe(201);
    const { jobId } = execRes.json();
    expect(jobId).toBeTruthy();

    const ready = await queue.dequeueReady(tenantA, 1, workerId, 30_000);
    expect(ready).toContain(jobId);
    await processJobOnce(tenantA, jobId, {
      lockMs: 30_000,
      heartbeatMs: 2_000,
      backoffMs: 500,
      maxAttempts: 3,
      appendEvent: (evt) => store.append({ ...evt, meta: { ...evt.meta, tenantId: tenantA } }),
      permissionEngine: perm,
      eventStore: store,
      queue: {
        lock: (jid, wid, ms, t) => queue.lock(jid, wid, ms, t),
        renewLock: (jid, wid, ms, t) => queue.renewLock(jid, wid, ms, t),
        isCanceled: (jid) => queue.isCanceled(jid),
        enqueue: (job) => queue.enqueue(job),
      },
      repo,
      workerId,
    });

    const events = await store.query({ tenantId: tenantA, decisionId, types: ["job.started", "job.succeeded"] });
    expect(events.map((e) => e.type).sort()).toEqual(["job.started", "job.succeeded"]);
    const toolEvents = await store.query({ tenantId: tenantA, decisionId, types: ["tool.echoed"] });
    expect(toolEvents.length).toBeGreaterThan(0);

    const timeline = await app.inject({
      method: "GET",
      url: `/timeline?jobId=${jobId}&limit=10`,
      headers: { "x-tenant-id": tenantA },
    });
    expect(timeline.statusCode).toBe(200);
    const body = timeline.json();
    expect(body.items?.length).toBeGreaterThan(0);
    body.items.forEach((item: any) => {
      expect(item.kind).toBeDefined();
      expect(item.payload?.outputSafe ?? "").not.toMatch(/\"actor\"/);
    });
    await app.close();
  });

  it("keeps tenant isolation for jobs and timeline", async () => {
    const audit = new AuditLogger(store);
    const perm = new PermissionEngine(store, audit, [{ domain: "tasks", action: "create", level: "allow" }]);
    const planner = new Planner({ eventStore: store, audit, permissions: perm });
    const sharedDecision = randomUUID();
    await planner.decide({
      intent: { type: "tasks.create", domain: "tasks", action: "create" },
      actor: { userId: "tester" },
      decisionId: sharedDecision,
      correlationId: "corr-a",
      tenantId: tenantA,
    });
    await planner.decide({
      intent: { type: "tasks.create", domain: "tasks", action: "create" },
      actor: { userId: "tester" },
      decisionId: sharedDecision,
      correlationId: "corr-b",
      tenantId: tenantB,
    });
    const app = buildServerWithDeps();
    await app.ready();
    const resA = await app.inject({
      method: "POST",
      url: `/decisions/${sharedDecision}/execute`,
      headers: { "x-tenant-id": tenantA },
    });
    const resB = await app.inject({
      method: "POST",
      url: `/decisions/${sharedDecision}/execute`,
      headers: { "x-tenant-id": tenantB },
    });
    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(201);
    const jobA = resA.json().jobId;
    const jobB = resB.json().jobId;
    const tlA = await app.inject({ method: "GET", url: `/timeline?jobId=${jobA}`, headers: { "x-tenant-id": tenantA } });
    const tlB = await app.inject({ method: "GET", url: `/timeline?jobId=${jobB}`, headers: { "x-tenant-id": tenantB } });
    expect(tlA.statusCode).toBe(200);
    expect(tlB.statusCode).toBe(200);
    expect(JSON.stringify(tlA.json())).not.toContain(jobB);
    expect(JSON.stringify(tlB.json())).not.toContain(jobA);
    await app.close();
  });
});
