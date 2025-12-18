"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobQueue = void 0;
const queueKey = (tenantId) => `queue:${tenantId}:jobs`;
const cancelKey = (jobId) => `jobcancel:${jobId}`;
const lockKey = (jobId) => `lock:${jobId}`;
class JobQueue {
    constructor(redis) {
        this.redis = redis;
    }
    async enqueue(job) {
        const score = new Date(job.runAt).getTime() - job.priority * 10;
        await this.redis.zadd(queueKey(job.tenantId), score, job.id);
    }
    async dequeueReady(tenantId, limit) {
        const now = Date.now();
        const ids = await this.redis.zrangebyscore(queueKey(tenantId), 0, now, "LIMIT", 0, limit);
        if (ids.length > 0) {
            await this.redis.zrem(queueKey(tenantId), ...ids);
        }
        return ids;
    }
    async lock(jobId, workerId, lockMs) {
        const res = await this.redis.set(lockKey(jobId), workerId, "PX", lockMs, "NX");
        return res === "OK";
    }
    async cancel(jobId) {
        await this.redis.set(cancelKey(jobId), "1", "EX", 3600);
    }
    async isCanceled(jobId) {
        const v = await this.redis.get(cancelKey(jobId));
        return v === "1";
    }
}
exports.JobQueue = JobQueue;
