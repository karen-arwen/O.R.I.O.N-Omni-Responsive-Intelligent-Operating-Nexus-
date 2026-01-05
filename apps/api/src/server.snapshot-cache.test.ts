import { afterEach, describe, it, expect, beforeEach } from "vitest";
import { buildServer } from "./server";
import { InMemoryEventStore } from "../../../packages/event-store/src";
import { RedisCache } from "./cache";
import { DomainEvent } from "../../../packages/shared/src";

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
}

const baseMeta = {
  actor: { userId: "tester" },
  source: "system" as const,
  decisionId: "dec-1",
  correlationId: "corr-1",
  tenantId: "local",
};

describe("snapshot cache keyed by etag", () => {
  let store: InMemoryEventStore;
  let cache: RedisCache;
  let server: ReturnType<typeof buildServer>;

  beforeEach(() => {
    store = new InMemoryEventStore();
    cache = new RedisCache(new FakeRedis() as any, 30);
    server = buildServer({
      eventStore: store,
      redisCache: cache,
      envOverrides: { ORION_DEV_AUTH_BYPASS: "true", ORION_CACHE_ENABLED: "true", ORION_RATE_LIMIT_BACKEND: "memory" },
    });
  });

  afterEach(async () => {
    await server.close();
  });

  const appendFinal = async (id: string, ts: string, summary: string) => {
    const evt: DomainEvent = {
      id,
      aggregateId: "agg-1",
      type: "decision.suggested",
      timestamp: ts,
      payload: { snapshot: { intent: { domain: "tasks", summary } } },
      meta: baseMeta,
    };
    await store.append(evt);
    return evt;
  };

  it("returns fresh snapshot when final event changes etag", async () => {
    const first = await appendFinal("00000000-0000-0000-0000-000000000001", "2024-01-01T00:00:00.000Z", "v1");

    const res1 = await server.inject({ method: "GET", url: `/decisions/${baseMeta.decisionId}/snapshot` });
    expect(res1.statusCode).toBe(200);
    const payload1 = res1.json();
    expect(payload1.snapshot.intent.summary).toBe("v1");
    const etag1 = res1.headers.etag?.replace(/"/g, "");
    expect(etag1).toBe(first.id);

    const cached = await cache.get<any>(`snapshot:${baseMeta.tenantId}:${baseMeta.decisionId}:v:${first.id}`);
    expect(cached?.snapshot.intent.summary).toBe("v1");

    const second = await appendFinal("00000000-0000-0000-0000-000000000002", "2024-01-01T00:00:10.000Z", "v2");

    const res2 = await server.inject({ method: "GET", url: `/decisions/${baseMeta.decisionId}/snapshot` });
    expect(res2.statusCode).toBe(200);
    const payload2 = res2.json();
    expect(payload2.snapshot.intent.summary).toBe("v2");
    const etag2 = res2.headers.etag?.replace(/"/g, "");
    expect(etag2).toBe(second.id);
    expect(etag2).not.toBe(etag1);

    await server.close();
  });
});
