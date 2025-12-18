"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisRateLimiter = exports.RedisCache = void 0;
class RedisCache {
    constructor(client, ttlSeconds = 30) {
        this.client = client;
        this.ttlSeconds = ttlSeconds;
    }
    async get(key) {
        const raw = await this.client.get(key);
        if (!raw)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    async set(key, value, ttlSeconds) {
        const ttl = ttlSeconds ?? this.ttlSeconds;
        await this.client.set(key, JSON.stringify(value), "EX", ttl);
    }
    async del(key) {
        await this.client.del(key);
    }
}
exports.RedisCache = RedisCache;
class RedisRateLimiter {
    constructor(client, limit, windowMs) {
        this.client = client;
        this.limit = limit;
        this.windowMs = windowMs;
    }
    async hit(key) {
        const ttlSeconds = Math.ceil(this.windowMs / 1000);
        const count = await this.client.incr(key);
        if (count === 1) {
            await this.client.expire(key, ttlSeconds);
        }
        if (count > this.limit) {
            const ttl = await this.client.ttl(key);
            return { allowed: false, retryAfter: ttl > 0 ? ttl : ttlSeconds };
        }
        return { allowed: true };
    }
}
exports.RedisRateLimiter = RedisRateLimiter;
