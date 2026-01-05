import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureIdempotencyKey, processJobOnce, recoverStaleJobs } from "./processor";
import { JobRecord } from "../../../packages/shared/src/jobs";
import { PermissionEngine } from "../../../packages/permissions/src";
import { InMemoryEventStore } from "../../../packages/event-store/src";
import { InMemoryJobRepository } from "../../api/src/jobs/inMemoryJobRepo";
import * as tools from "../../../packages/tools/src";

const baseJob = (over: Partial<JobRecord> = {}): JobRecord => ({
  id: "job-1",
  tenantId: "tenant-a",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  decisionId: "dec-1",
  correlationId: "corr-1",
  domain: "tasks",
  type: "tool.create_note",
  status: "queued",
  priority: 0,
  attempts: 0,
  maxAttempts: 2,
  runAt: new Date().toISOString(),
  input: {},
  lockedAt: null,
  lockedBy: null,
  idempotencyKey: null,
  output: null,
  error: null,
  traceEventIds: null,
  etag: null,
  ...over,
});

class FakeRepo {
  job: JobRecord;
  constructor(job: JobRecord) {
    this.job = job;
  }
  async acquireForRun(_t: string, _id: string) {
    if (this.job.status !== "queued") return null;
    this.job = { ...this.job, status: "running", lockedAt: new Date().toISOString(), lockedBy: "w1" };
    return this.job;
  }
  async updateStatus(_t: string, _id: string, patch: Partial<JobRecord>) {
    this.job = { ...this.job, ...patch, updatedAt: new Date().toISOString() };
    return this.job;
  }
}

class FakeQueue {
  locked = false;
  canceled = false;
  enqueued: JobRecord[] = [];
  renewOk = true;
  constructor(canceled = false) {
    this.canceled = canceled;
  }
  async lock() {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }
  async isCanceled() {
    return this.canceled;
  }
  async enqueue(job: JobRecord) {
    this.enqueued.push(job);
  }
  async renewLock() {
    return this.renewOk;
  }
}

const makePermEngine = (mode: "allow" | "deny" | "requires"): PermissionEngine =>
  ({
    evaluate: vi.fn().mockResolvedValue({
      decision: {
        allowed: mode === "allow",
        requiresApproval: mode === "requires",
        level: mode === "requires" ? "require-approval" : mode,
        reason: mode === "deny" ? "policy-block" : "ok",
        risk: "medium",
        riskReasons: [],
        policy: "test",
      },
    }),
  } as unknown as PermissionEngine);

afterEach(() => {
  vi.restoreAllMocks();
});

const run = async ({
  job = baseJob(),
  perm = makePermEngine("allow"),
  queueCanceled = false,
  heartbeatMs,
}: {
  job?: JobRecord;
  perm?: PermissionEngine;
  queueCanceled?: boolean;
  heartbeatMs?: number;
}) => {
  const repo = new FakeRepo(job);
  const queue = new FakeQueue(queueCanceled);
  const events: any[] = [];
  await processJobOnce(job.tenantId, job.id, {
    lockMs: 1000,
    heartbeatMs,
    backoffMs: 10,
    maxAttempts: job.maxAttempts,
    appendEvent: async (e) => events.push(e),
    permissionEngine: perm,
    eventStore: new InMemoryEventStore(),
    queue,
    repo,
    workerId: "w1",
  });
  return { repo, events, queue };
};

describe("worker permission recheck", () => {
  it("fails on permission deny", async () => {
    const { repo, events } = await run({ perm: makePermEngine("deny") });
    expect(repo.job.status).toBe("failed");
    const failed = events.find((e: any) => e.type === "job.failed");
    expect(failed.payload.errorSafe.code).toBe("permission_denied");
  });

  it("marks awaiting approval when requires", async () => {
    const { repo, events } = await run({ perm: makePermEngine("requires") });
    expect(repo.job.status).toBe("awaiting_approval");
    const awaiting = events.find((e: any) => e.type === "job.awaiting_approval");
    expect(awaiting).toBeTruthy();
    expect(events.find((e: any) => e.type === "decision.awaiting_approval")).toBeTruthy();
  });

  it("emits started and succeeded when allowed", async () => {
    const { repo, events } = await run({});
    expect(repo.job.status).toBe("succeeded");
    expect(events.some((e: any) => e.type === "job.started")).toBe(true);
    expect(events.some((e: any) => e.type === "job.succeeded")).toBe(true);
    expect(repo.job.output).toBeDefined();
  });

  it("retries and moves to dead_letter after max attempts", async () => {
    const failingTool = { name: "tool.create_note", execute: vi.fn().mockRejectedValue(new Error("boom")) };
    const spy = vi.spyOn(tools, "getTool").mockReturnValue(failingTool as any);
    const repo = new FakeRepo(baseJob({ maxAttempts: 2 }));
    const queue = new FakeQueue(false);
    const events: any[] = [];
    const deps = {
      lockMs: 1000,
      backoffMs: 1,
      maxAttempts: 2,
      appendEvent: async (e: any) => events.push(e),
      permissionEngine: makePermEngine("allow"),
      eventStore: new InMemoryEventStore(),
      queue,
      repo,
      workerId: "w1",
    };
    await processJobOnce(repo.job.tenantId, repo.job.id, deps);
    queue.locked = false;
    await processJobOnce(repo.job.tenantId, repo.job.id, deps);
    expect(events.some((e: any) => e.type === "job.retried")).toBe(true);
    expect(events.some((e: any) => e.type === "job.dead_letter")).toBe(true);
    expect(repo.job.status).toBe("dead_letter");
    spy.mockRestore();
  });

  it("respects cancel flag", async () => {
    const { repo, events } = await run({ queueCanceled: true });
    expect(repo.job.status).toBe("canceled");
    expect(events.find((e: any) => e.type === "job.canceled")).toBeTruthy();
  });

  it("throws in dev when tool event lacks idempotencyKey", () => {
    const evt = {
      id: "x",
      aggregateId: "agg",
      type: "tool.echoed",
      timestamp: new Date().toISOString(),
      payload: {},
      meta: { actor: { userId: "u" }, source: "system" },
    } as any;
    expect(() => ensureIdempotencyKey(evt, undefined)).toThrow(/idempotencyKey/);
  });

  it("renews lock during long runs", async () => {
    const slowTool = { name: "tool.create_note", execute: vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { output: "ok" };
    }) };
    const renewSpy = vi.fn().mockResolvedValue(true);
    const lockSpy = vi.fn().mockResolvedValue(true);
    vi.spyOn(tools, "getTool").mockReturnValue(slowTool as any);
    const repo = new FakeRepo(baseJob());
    const queue = new FakeQueue(false);
    queue.renewOk = true;
    const events: any[] = [];
    await processJobOnce(repo.job.tenantId, repo.job.id, {
      lockMs: 20,
      heartbeatMs: 5,
      backoffMs: 10,
      maxAttempts: 2,
      appendEvent: async (e) => events.push(e),
      permissionEngine: makePermEngine("allow"),
      eventStore: new InMemoryEventStore(),
      queue: { lock: lockSpy, renewLock: renewSpy, isCanceled: queue.isCanceled.bind(queue), enqueue: queue.enqueue.bind(queue) },
      repo,
      workerId: "w1",
    });
    expect(renewSpy).toHaveBeenCalled();
    expect(repo.job.status).toBe("succeeded");
    vi.spyOn(tools, "getTool").mockRestore();
  });

  it("stops finalization when lock renewal fails", async () => {
    const slowTool = { name: "tool.create_note", execute: vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { output: "ok" };
    }) };
    vi.spyOn(tools, "getTool").mockReturnValue(slowTool as any);
    const repo = new FakeRepo(baseJob());
    const queue = new FakeQueue(false);
    queue.renewOk = false;
    const events: any[] = [];
    await processJobOnce(repo.job.tenantId, repo.job.id, {
      lockMs: 20,
      heartbeatMs: 5,
      backoffMs: 10,
      maxAttempts: 2,
      appendEvent: async (e) => events.push(e),
      permissionEngine: makePermEngine("allow"),
      eventStore: new InMemoryEventStore(),
      queue: { lock: queue.lock.bind(queue), renewLock: queue.renewLock.bind(queue), isCanceled: queue.isCanceled.bind(queue), enqueue: queue.enqueue.bind(queue) },
      repo,
      workerId: "w1",
    });
    expect(events.some((e: any) => e.type === "job.lock_renew_failed")).toBe(true);
    expect(events.some((e: any) => e.type === "job.succeeded")).toBe(false);
    expect(repo.job.status).toBe("running"); // not finalized without lock
    vi.spyOn(tools, "getTool").mockRestore();
  });

  it("dedupes already succeeded jobs", async () => {
    const store = new InMemoryEventStore([
      {
        id: "evt-s1",
        aggregateId: "dec-dup",
        type: "job.succeeded",
        timestamp: new Date().toISOString(),
        payload: { jobId: "job-dup" },
        meta: { actor: { userId: "worker" }, source: "system", decisionId: "dec-dup", tenantId: "tenant-a", idempotencyKey: "job-dup:succeeded" },
      },
    ]);
    const repo = new FakeRepo(baseJob({ id: "job-dup", decisionId: "dec-dup" }));
    const events: any[] = [];
    await processJobOnce(repo.job.tenantId, repo.job.id, {
      lockMs: 20,
      heartbeatMs: 5,
      backoffMs: 10,
      maxAttempts: 2,
      appendEvent: async (e) => events.push(e),
      permissionEngine: makePermEngine("allow"),
      eventStore: store,
      queue: { lock: async () => true, renewLock: async () => true, isCanceled: async () => false, enqueue: async () => {} },
      repo,
      workerId: "w1",
    });
    expect(repo.job.status).toBe("succeeded");
    expect(events.some((e: any) => e.type === "job.succeeded")).toBe(false);
    expect(events.some((e: any) => e.type === "job.duplicate_suppressed")).toBe(true);
  });

  it("dedupes duplicate tool events by idempotencyKey", async () => {
    const toolEvt = {
      id: "tool-1",
      aggregateId: "dec-dup-tool",
      type: "tool.echoed",
      timestamp: new Date().toISOString(),
      payload: { jobId: "job-tool", summarySafe: "echo" },
      meta: { actor: { userId: "worker" }, source: "system", decisionId: "dec-dup-tool", tenantId: "tenant-a" },
    };
    const store = new InMemoryEventStore([ensureIdempotencyKey(toolEvt, "job-tool:tool.echoed")]);
    const dupTool = {
      name: "tool.echo",
      execute: vi.fn().mockImplementation(async ({ eventSink }: any) => {
        await eventSink.append({ ...toolEvt, id: "tool-2", meta: { ...toolEvt.meta } });
        await eventSink.append({ ...toolEvt, id: "tool-3", meta: { ...toolEvt.meta } });
        return { output: "ok" };
      }),
    };
    vi.spyOn(tools, "getTool").mockReturnValue(dupTool as any);
    const repo = new FakeRepo(baseJob({ id: "job-tool", decisionId: "dec-dup-tool" }));
    const events: any[] = [];
    await processJobOnce(repo.job.tenantId, repo.job.id, {
      lockMs: 1000,
      heartbeatMs: 10,
      backoffMs: 10,
      maxAttempts: 2,
      appendEvent: async (e) => events.push(e),
      permissionEngine: makePermEngine("allow"),
      eventStore: store,
      queue: { lock: async () => true, renewLock: async () => true, isCanceled: async () => false, enqueue: async () => {} },
      repo,
      workerId: "w1",
    });
    const toolEvents = events.filter((e: any) => e.type.startsWith("tool."));
    expect(toolEvents.length).toBe(0); // deduped, only original existed
    const dupSuppressed = events.find((e: any) => e.type === "job.duplicate_suppressed");
    expect(dupSuppressed).toBeTruthy();
    vi.spyOn(tools, "getTool").mockRestore();
  });

  it("recovers stale running jobs", async () => {
    const repo = new InMemoryJobRepository();
    const { job } = await repo.createJob("tenant-r", { type: "tool.create_note", input: {}, runAt: new Date(Date.now() - 100000).toISOString() });
    await repo.updateStatus("tenant-r", job.id, { status: "running", lockedAt: new Date(Date.now() - 120000).toISOString(), lockedBy: "w0" });
    const queued: JobRecord[] = [];
    const events: any[] = [];
    await recoverStaleJobs("tenant-r", 60_000, {
      repo,
      queue: { enqueue: async (j: JobRecord) => queued.push(j) },
      emit: async (evt) => events.push(evt),
      eventStore: new InMemoryEventStore(),
    });
    const refreshed = await repo.getJob("tenant-r", job.id);
    expect(refreshed?.status).toBe("queued");
    expect(queued.map((q) => q.id)).toContain(job.id);
    expect(events.some((e: any) => e.type === "job.recovered")).toBe(true);
  });
});
