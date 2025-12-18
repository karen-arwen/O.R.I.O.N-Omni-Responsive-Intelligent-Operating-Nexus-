import Redis from "ioredis";
import { JobRecord } from "../../../../packages/shared/src/jobs";

const queueKey = (tenantId: string) => `queue:${tenantId}:jobs`;
const cancelKey = (jobId: string) => `jobcancel:${jobId}`;
const lockKey = (jobId: string) => `lock:${jobId}`;

export class JobQueue {
  constructor(private redis: Redis) {}

  async enqueue(job: JobRecord) {
    const score = new Date(job.runAt).getTime() - job.priority * 10;
    await this.redis.zadd(queueKey(job.tenantId), score, job.id);
  }

  async dequeueReady(tenantId: string, limit: number): Promise<string[]> {
    const now = Date.now();
    const ids = await this.redis.zrangebyscore(queueKey(tenantId), 0, now, "LIMIT", 0, limit);
    if (ids.length > 0) {
      await this.redis.zrem(queueKey(tenantId), ...ids);
    }
    return ids;
  }

  async lock(jobId: string, workerId: string, lockMs: number): Promise<boolean> {
    const res = await this.redis.set(lockKey(jobId), workerId, "PX", lockMs, "NX");
    return res === "OK";
  }

  async cancel(jobId: string) {
    await this.redis.set(cancelKey(jobId), "1", "EX", 3600);
  }

  async isCanceled(jobId: string): Promise<boolean> {
    const v = await this.redis.get(cancelKey(jobId));
    return v === "1";
  }
}
