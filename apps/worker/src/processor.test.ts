import { afterEach, describe, expect, it, vi } from "vitest";
import { processJobOnce } from "./processor";
import { JobRecord } from "../../../packages/shared/src/jobs";
import { PermissionEngine } from "../../../packages/permissions/src";
import { InMemoryEventStore } from "../../../packages/event-store/src";
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
}: {
  job?: JobRecord;
  perm?: PermissionEngine;
  queueCanceled?: boolean;
}) => {
  const repo = new FakeRepo(job);
  const queue = new FakeQueue(queueCanceled);
  const events: any[] = [];
  await processJobOnce(job.tenantId, job.id, {
    lockMs: 1000,
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

  it("fails on requires approval terminally", async () => {
    const { repo, events } = await run({ perm: makePermEngine("requires") });
    expect(repo.job.status).toBe("failed");
    const failed = events.find((e: any) => e.type === "job.failed");
    expect(failed.payload.errorSafe.code).toBe("requires_approval");
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
});
