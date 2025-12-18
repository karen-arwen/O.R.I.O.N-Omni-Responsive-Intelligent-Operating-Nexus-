import { describe, it, expect } from "vitest";
import { RedisCache, RedisRateLimiter } from "./cache";

class FakeRedis {
  store = new Map<string, { value: string; expireAt?: number }>();
  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expireAt && entry.expireAt < Date.now()) return null;
    return entry.value;
  }
  async set(key: string, value: string, mode?: string, ttl?: number) {
    const expireAt = mode === "EX" && ttl ? Date.now() + ttl * 1000 : undefined;
    this.store.set(key, { value, expireAt });
  }
  async del(key: string) {
    this.store.delete(key);
  }
  async incr(key: string) {
    const current = Number((await this.get(key)) ?? "0");
    const next = current + 1;
    this.store.set(key, { value: String(next) });
    return next;
  }
  async expire(key: string, ttl: number) {
    const entry = this.store.get(key);
    if (entry) {
      entry.expireAt = Date.now() + ttl * 1000;
      this.store.set(key, entry);
    }
  }
  async ttl(key: string) {
    const entry = this.store.get(key);
    if (!entry?.expireAt) return -1;
    return Math.ceil((entry.expireAt - Date.now()) / 1000);
  }
}

describe("RedisCache (fake)", () => {
  it("sets and gets values", async () => {
    const fake = new FakeRedis() as any;
    const cache = new RedisCache(fake, 10);
    await cache.set("k", { a: 1 });
    const v = await cache.get<{ a: number }>("k");
    expect(v?.a).toBe(1);
  });
});

describe("RedisRateLimiter (fake)", () => {
  it("blocks after limit", async () => {
    const fake = new FakeRedis() as any;
    const limiter = new RedisRateLimiter(fake, 1, 1000);
    const first = await limiter.hit("rl:test");
    expect(first.allowed).toBe(true);
    const second = await limiter.hit("rl:test");
    expect(second.allowed).toBe(false);
  });
});

