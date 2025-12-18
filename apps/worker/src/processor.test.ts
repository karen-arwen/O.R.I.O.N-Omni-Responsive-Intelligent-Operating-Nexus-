import { describe, it, expect, vi } from "vitest";
import { processJobOnce } from "./processor";
import { JobRecord } from "../../../packages/shared/src/jobs";
import { PermissionEngine } from "../../../packages/permissions/src";
import { InMemoryEventStore } from "../../../packages/event-store/src";

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
  ...over,
});

class FakeRepo {
  job: JobRecord;
  constructor(job: JobRecord) {
    this.job = job;
  }
  async acquireForRun(_t: string, _id: string) {
    return this.job;
  }
  async updateStatus(_t: string, _id: string, patch: Partial<JobRecord>) {
    this.job = { ...this.job, ...patch, updatedAt: new Date().toISOString() };
    return this.job;
  }
}

class FakeQueue {
  locked = false;
  async lock() {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }
  async isCanceled() {
    return false;
  }
  async enqueue() {}
}

const makePermEngine = (decision: "allow" | "deny" | "requires_approval") =>
  ({
    evaluate: vi.fn().mockResolvedValue({ decision: { decision } }),
  } as unknown as PermissionEngine);

const run = async (decision: "allow" | "deny" | "requires_approval") => {
  const job = baseJob();
  const repo = new FakeRepo(job);
  const queue = new FakeQueue();
  const events: any[] = [];
  await processJobOnce(job.tenantId, job.id, {
    lockMs: 1000,
    backoffMs: 1000,
    maxAttempts: 2,
    appendEvent: async (e) => events.push(e),
    permissionEngine: makePermEngine(decision),
    eventStore: new InMemoryEventStore(),
    queue,
    repo,
    workerId: "w1",
  });
  return { job: repo.job, events };
};

describe("worker permission recheck", () => {
  it("fails on permission deny", async () => {
    const { job, events } = await run("deny");
    expect(job.status).toBe("failed");
    expect(events.find((e: any) => e.type === "job.failed")).toBeTruthy();
  });

  it("fails on requires approval", async () => {
    const { job, events } = await run("requires_approval");
    expect(job.status).toBe("failed");
    const failed = events.find((e: any) => e.type === "job.failed");
    expect(failed.payload.errorSafe.code).toBe("requires_approval");
  });

  it("succeeds when allowed", async () => {
    const { job, events } = await run("allow");
    expect(job.status).toBe("succeeded");
    expect(events.some((e: any) => e.type === "job.succeeded")).toBe(true);
  });
});
