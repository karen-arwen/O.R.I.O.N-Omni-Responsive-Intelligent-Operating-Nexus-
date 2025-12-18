import Redis from "ioredis";

export class RedisCache {
  constructor(private client: Redis, private ttlSeconds = 30) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number) {
    const ttl = ttlSeconds ?? this.ttlSeconds;
    await this.client.set(key, JSON.stringify(value), "EX", ttl);
  }

  async del(key: string) {
    await this.client.del(key);
  }
}

export class RedisRateLimiter {
  constructor(private client: Redis, private limit: number, private windowMs: number) {}

  async hit(key: string): Promise<{ allowed: boolean; retryAfter?: number }> {
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

