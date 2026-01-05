import { describe, expect, it } from "vitest";
import { JobQueue } from "./queue";

class FakeRedis {
  zsets = new Map<string, Map<string, number>>();
  kv = new Map<string, string>();
  async zadd(key: string, score: number, member: string) {
    const set = this.zsets.get(key) ?? new Map<string, number>();
    set.set(member, score);
    this.zsets.set(key, set);
  }
  async zrangebyscore(key: string, min: number, max: number, _limit?: string, _offset?: number, _count?: number) {
    const set = this.zsets.get(key) ?? new Map<string, number>();
    return Array.from(set.entries())
      .filter(([, score]) => score >= min && score <= max)
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .map(([member]) => member);
  }
  async zrem(key: string, ...members: string[]) {
    const set = this.zsets.get(key);
    if (!set) return 0;
    let removed = 0;
    members.forEach((m) => {
      if (set.delete(m)) removed += 1;
    });
    return removed;
  }
  async set(key: string, value: string, mode?: string, _px?: number, cond?: string) {
    if (cond === "NX" && this.kv.has(key)) return null;
    if (cond === "XX" && !this.kv.has(key)) return null;
    this.kv.set(key, value);
    return "OK";
  }
  async get(key: string) {
    return this.kv.get(key) ?? null;
  }
  async pexpire(key: string) {
    return this.kv.has(key) ? 1 : 0;
  }
  async zcard(key: string) {
    return (this.zsets.get(key) ?? new Map()).size;
  }
}

describe("JobQueue hardening", () => {
  it("only dequeues when lock succeeds", async () => {
    const redis = new FakeRedis();
    const queue = new JobQueue(redis as any);
    await queue.enqueue({
      id: "job-1",
      tenantId: "t1",
      runAt: new Date().toISOString(),
      priority: 0,
    } as any);
    // Simulate lock held by another worker
    await redis.set("lock:t1:job-1", "other", "PX", 1000, "NX");
    const ids = await queue.dequeueReady("t1", 1, "worker-a", 1000);
    expect(ids).toHaveLength(0);
    // still present in zset
    const remaining = await redis.zrangebyscore("queue:t1:jobs", -Infinity as any, Date.now());
    expect(remaining).toContain("job-1");
    // release and lock again
    redis.kv.delete("lock:t1:job-1");
    const ids2 = await queue.dequeueReady("t1", 1, "worker-a", 1000);
    expect(ids2).toEqual(["job-1"]);
    const after = await redis.zrangebyscore("queue:t1:jobs", -Infinity as any, Date.now());
    expect(after).toHaveLength(0);
  });

  it("returns pending count per tenant", async () => {
    const redis = new FakeRedis();
    const queue = new JobQueue(redis as any);
    await queue.enqueue({ id: "job-1", tenantId: "ta", runAt: new Date().toISOString(), priority: 0 } as any);
    await queue.enqueue({ id: "job-2", tenantId: "tb", runAt: new Date().toISOString(), priority: 0 } as any);
    await queue.enqueue({ id: "job-3", tenantId: "ta", runAt: new Date().toISOString(), priority: 0 } as any);
    expect(await queue.pendingCount("ta")).toBe(2);
    expect(await queue.pendingCount("tb")).toBe(1);
  });
});
