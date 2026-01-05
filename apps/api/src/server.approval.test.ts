import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { buildServer } from "./server";
import { InMemoryEventStore } from "../../../packages/event-store/src";
import { AuditLogger } from "../../../packages/audit/src";
import { PermissionEngine } from "../../../packages/permissions/src";
import { InMemoryJobRepository } from "./jobs/inMemoryJobRepo";
import { DomainEvent } from "../../../packages/shared/src";

class FakeJobQueue {
  enqueued: string[] = [];
  async enqueue(job: { id: string }) {
    this.enqueued.push(job.id);
  }
  async cancel() {}
}

const decisionEvent = (decisionId: string, tenantId = "local"): DomainEvent => ({
  id: `evt-${decisionId}`,
  aggregateId: decisionId,
  type: "decision.ready_to_execute",
  timestamp: new Date().toISOString(),
  payload: {
    snapshot: { intent: { type: "tasks.create", domain: "tasks", action: "create" }, mode: "ready_to_execute" },
  },
  meta: { actor: { userId: "u1" }, source: "system", decisionId, correlationId: decisionId, tenantId },
});

describe("Approval flow", () => {
  let store: InMemoryEventStore;
  let audit: AuditLogger;
  let permissions: PermissionEngine;
  let jobRepo: InMemoryJobRepository;
  let jobQueue: FakeJobQueue;
  let server: ReturnType<typeof buildServer> | null = null;

  beforeEach(() => {
    store = new InMemoryEventStore();
    audit = new AuditLogger(store);
    permissions = new PermissionEngine(store, audit, [{ domain: "tasks", action: "create", level: "allow" }]);
    jobRepo = new InMemoryJobRepository();
    jobQueue = new FakeJobQueue();
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    delete process.env.ORION_AUTH_TOKEN_ROLES_valid;
  });

  it("returns 404 when decision missing", async () => {
    server = buildServer({ eventStore: store, auditLogger: audit, permissionEngine: permissions, jobRepo, jobQueue });
    const res = await server.inject({ method: "POST", url: "/decisions/unknown/approve" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("decision_not_found");
  });

  it("returns 409 when no job awaiting approval", async () => {
    await store.append(decisionEvent("dec-nojob"));
    server = buildServer({ eventStore: store, auditLogger: audit, permissionEngine: permissions, jobRepo, jobQueue });
    const res = await server.inject({ method: "POST", url: "/decisions/dec-nojob/approve" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("no_job_awaiting_approval");
  });

  it("approves awaiting job, emits events, requeues and is idempotent", async () => {
    await store.append(decisionEvent("dec-await"));
    const { job } = await jobRepo.createJob("local", { decisionId: "dec-await", type: "tool.create_note", input: {}, idempotencyKey: "dec-await" });
    await jobRepo.updateStatus("local", job.id, { status: "awaiting_approval" });
    server = buildServer({ eventStore: store, auditLogger: audit, permissionEngine: permissions, jobRepo, jobQueue });

    const first = await server.inject({ method: "POST", url: "/decisions/dec-await/approve", payload: { reason: "ok" } });
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.status).toBe("queued");
    expect(jobQueue.enqueued).toContain(body.jobId);
    const events = await store.query({ decisionId: "dec-await", types: ["job.approved", "decision.approved", "job.queued"], tenantId: "local" });
    expect(events.map((e) => e.type).sort()).toEqual(["decision.approved", "job.approved", "job.queued"]);

    const second = await server.inject({ method: "POST", url: "/decisions/dec-await/approve", payload: { reason: "ok" } });
    expect(second.statusCode).toBe(200);
    const afterEvents = await store.query({ decisionId: "dec-await", types: ["job.approved"], tenantId: "local" });
    expect(afterEvents.length).toBe(1);
  });

  it("enforces admin-only approval", async () => {
    await store.append(decisionEvent("dec-rbac"));
    const { job } = await jobRepo.createJob("local", { decisionId: "dec-rbac", type: "tool.create_note", input: {} });
    await jobRepo.updateStatus("local", job.id, { status: "awaiting_approval" });
    server = buildServer({
      eventStore: store,
      auditLogger: audit,
      permissionEngine: permissions,
      jobRepo,
      jobQueue,
      envOverrides: { ORION_DEV_AUTH_BYPASS: "false", ORION_AUTH_TOKENS: "valid" },
    });
    process.env.ORION_AUTH_TOKEN_ROLES_valid = "member";
    const res = await server.inject({ method: "POST", url: "/decisions/dec-rbac/approve", headers: { authorization: "Bearer valid" } });
    expect(res.statusCode).toBe(403);
  });

  it("isolates tenants", async () => {
    await store.append(decisionEvent("dec-tenant", "tenant-a"));
    const { job } = await jobRepo.createJob("tenant-a", { decisionId: "dec-tenant", type: "tool.create_note", input: {} });
    await jobRepo.updateStatus("tenant-a", job.id, { status: "awaiting_approval" });
    server = buildServer({ eventStore: store, auditLogger: audit, permissionEngine: permissions, jobRepo, jobQueue });
    const res = await server.inject({
      method: "POST",
      url: "/decisions/dec-tenant/approve",
      headers: { "x-tenant-id": "tenant-b" },
    });
    expect(res.statusCode).toBe(404);
  });
});
