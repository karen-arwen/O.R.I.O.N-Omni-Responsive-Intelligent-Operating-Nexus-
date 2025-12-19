import { beforeEach, describe, expect, it, afterEach } from "vitest";
import { buildServer } from "./server";
import { InMemoryEventStore } from "../../../packages/event-store/src";
import { AuditLogger } from "../../../packages/audit/src";
import { PermissionEngine } from "../../../packages/permissions/src";
import { Planner } from "../../../packages/planner/src/planner";
import { InMemoryJobRepository } from "./jobs/inMemoryJobRepo";
import { JobRecord } from "../../../packages/shared/src/jobs";

class FakeJobQueue {
  enqueued: string[] = [];
  canceled: string[] = [];
  async enqueue(job: JobRecord) {
    this.enqueued.push(job.id);
  }
  async cancel(jobId: string) {
    this.canceled.push(jobId);
  }
}

describe("POST /decisions/:decisionId/execute contract", () => {
  let store: InMemoryEventStore;
  let audit: AuditLogger;
  let permissions: PermissionEngine;
  let jobRepo: InMemoryJobRepository;
  let jobQueue: FakeJobQueue;

  beforeEach(() => {
    store = new InMemoryEventStore();
    audit = new AuditLogger(store);
    permissions = new PermissionEngine(store, audit, [{ domain: "tasks", action: "create", level: "allow" }]);
    jobRepo = new InMemoryJobRepository();
    jobQueue = new FakeJobQueue();
  });

  afterEach(() => {
    delete process.env.ORION_AUTH_TOKEN_ROLES_valid;
  });

  const buildReadyDecision = async (decisionId: string, tenantId = "local", correlationId = decisionId) => {
    const planner = new Planner({ eventStore: store, audit, permissions });
    await planner.decide({
      intent: { type: "tasks.create", domain: "tasks", action: "create" },
      actor: { userId: "u1" },
      decisionId,
      correlationId,
      tenantId,
    });
  };

  it("returns 404 for unknown decision", async () => {
    const server = buildServer({ eventStore: store, auditLogger: audit, permissionEngine: permissions, jobRepo, jobQueue });
    const res = await server.inject({ method: "POST", url: "/decisions/missing/execute" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("decision_not_found");
  });

  it("rejects non-ready decisions with 409", async () => {
    const conservativePerms = new PermissionEngine(store, audit); // default require-approval => suggested
    const server = buildServer({ eventStore: store, auditLogger: audit, permissionEngine: conservativePerms, jobRepo, jobQueue });
    const planner = new Planner({ eventStore: store, audit, permissions: conservativePerms });
    await planner.decide({
      intent: { type: "tasks.create", domain: "tasks", action: "create" },
      actor: { userId: "u1" },
      decisionId: "dec-not-ready",
    });
    const res = await server.inject({ method: "POST", url: "/decisions/dec-not-ready/execute" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("not_executable");
  });

  it("creates a job idempotently, emits job.created/job.queued, and enqueues", async () => {
    await buildReadyDecision("dec-exec", "tenant-a", "corr-exec");
    const server = buildServer({ eventStore: store, auditLogger: audit, permissionEngine: permissions, jobRepo, jobQueue });

    const first = await server.inject({ method: "POST", url: "/decisions/dec-exec/execute", headers: { "x-tenant-id": "tenant-a" } });
    expect(first.statusCode).toBe(201);
    const body = first.json();
    expect(body.jobId).toBeDefined();
    expect(body.correlationId).toBe("corr-exec");
    expect(jobQueue.enqueued).toContain(body.jobId);

    const events = await store.query({ decisionId: "dec-exec", tenantId: "tenant-a", types: ["job.created", "job.queued"] });
    expect(events.map((e) => e.type).sort()).toEqual(["job.created", "job.queued"]);

    const again = await server.inject({ method: "POST", url: "/decisions/dec-exec/execute", headers: { "x-tenant-id": "tenant-a" } });
    expect(again.statusCode).toBe(200);
    expect(again.json().jobId).toBe(body.jobId);
    const eventsAfter = await store.query({ decisionId: "dec-exec", tenantId: "tenant-a", types: ["job.created", "job.queued"] });
    expect(eventsAfter.length).toBe(2);
  });

  it("isolates tenants for idempotency", async () => {
    await buildReadyDecision("dec-shared", "tenant-a", "corr-a");
    await buildReadyDecision("dec-shared", "tenant-b", "corr-b");
    const server = buildServer({ eventStore: store, auditLogger: audit, permissionEngine: permissions, jobRepo, jobQueue });

    const resA = await server.inject({ method: "POST", url: "/decisions/dec-shared/execute", headers: { "x-tenant-id": "tenant-a" } });
    const resB = await server.inject({ method: "POST", url: "/decisions/dec-shared/execute", headers: { "x-tenant-id": "tenant-b" } });
    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(201);
    expect(resA.json().jobId).not.toBe(resB.json().jobId);
  });

  it("enforces auth/roles (401/403)", async () => {
    const server = buildServer({
      eventStore: store,
      auditLogger: audit,
      permissionEngine: permissions,
      jobRepo,
      jobQueue,
      envOverrides: { ORION_DEV_AUTH_BYPASS: "false", ORION_AUTH_TOKENS: "valid" },
    });
    const noAuth = await server.inject({ method: "POST", url: "/decisions/dec-auth/execute" });
    expect(noAuth.statusCode).toBe(401);

    process.env.ORION_AUTH_TOKEN_ROLES_valid = "viewer";
    const forbidden = await server.inject({
      method: "POST",
      url: "/decisions/dec-auth/execute",
      headers: { authorization: "Bearer valid" },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});
