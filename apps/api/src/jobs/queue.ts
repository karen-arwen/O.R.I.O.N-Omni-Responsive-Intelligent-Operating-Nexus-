import Redis from "ioredis";
import { JobRecord } from "../../../../packages/shared/src/jobs";

const queueKey = (tenantId: string) => `queue:${tenantId}:jobs`;
const cancelKey = (jobId: string) => `jobcancel:${jobId}`;
const lockKey = (jobId: string, tenantId?: string) => `lock:${tenantId ? `${tenantId}:` : ""}${jobId}`;

export class JobQueue {
  constructor(private redis: Redis) {}

  async enqueue(job: JobRecord) {
    const score = new Date(job.runAt).getTime() - job.priority * 10;
    await this.redis.zadd(queueKey(job.tenantId), score, job.id);
  }

  async pendingCount(tenantId: string): Promise<number> {
    return this.redis.zcard(queueKey(tenantId));
  }

  async dequeueReady(tenantId: string, limit: number, workerId?: string, lockMs?: number): Promise<string[]> {
    const now = Date.now();
    const results: string[] = [];
    const key = queueKey(tenantId);
    while (results.length < limit) {
      const ids = await this.redis.zrangebyscore(key, 0, now, "LIMIT", 0, limit - results.length);
      if (!ids.length) break;
      let lockedAny = false;
      for (const id of ids) {
        let locked = true;
        if (workerId && lockMs) {
          locked = await this.lock(id, workerId, lockMs, tenantId);
        }
        if (locked) {
          await this.redis.zrem(key, id);
          results.push(id);
          lockedAny = true;
        }
        if (results.length >= limit) break;
      }
      if (!lockedAny) break;
    }
    return results;
  }

  async lock(jobId: string, workerId: string, lockMs: number, tenantId?: string): Promise<boolean> {
    const key = lockKey(jobId, tenantId);
    const current = await this.redis.get(key);
    if (current === workerId) {
      await this.redis.pexpire(key, lockMs);
      return true;
    }
    const res = await this.redis.set(key, workerId, "PX", lockMs, "NX");
    return res === "OK";
  }

  async renewLock(jobId: string, workerId: string, lockMs: number, tenantId?: string): Promise<boolean> {
    const key = lockKey(jobId, tenantId);
    const owner = await this.redis.get(key);
    if (owner !== workerId) return false;
    const res = await this.redis.pexpire(key, lockMs);
    return res === 1;
  }

  async cancel(jobId: string) {
    await this.redis.set(cancelKey(jobId), "1", "EX", 3600);
  }

  async isCanceled(jobId: string): Promise<boolean> {
    const v = await this.redis.get(cancelKey(jobId));
    return v === "1";
  }
}
