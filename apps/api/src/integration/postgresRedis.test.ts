import { describe, it, expect, beforeAll } from "vitest";
import { Pool } from "pg";
import Redis from "ioredis";
import { PostgresEventStore } from "../../../packages/event-store/src/postgresEventStore.ts";
import { DomainEvent } from "../../../packages/shared/src";

const dbUrl = process.env.ORION_DB_URL;
const redisUrl = process.env.ORION_REDIS_URL;

const skipAll = !dbUrl || !redisUrl;

describe.skipIf(skipAll)("integration: postgres + redis", () => {
  const pool = new Pool({ connectionString: dbUrl });
  const redis = new Redis(redisUrl as string);
  const store = new PostgresEventStore({ pool });

  beforeAll(async () => {
    await pool.query("DELETE FROM events");
  });

  it("append/query by tenant", async () => {
    const ev: DomainEvent = {
      id: "int-1",
      aggregateId: "agg-int",
      type: "decision.created",
      timestamp: new Date().toISOString(),
      payload: {},
      meta: { actor: { userId: "u" }, source: "user", decisionId: "dec-int", correlationId: "corr-int", tenantId: "tenant-int" },
    };
    await store.append(ev);
    const res = await store.query({ tenantId: "tenant-int" });
    expect(res.length).toBe(1);
  });

  it("redis rate key increments", async () => {
    await redis.del("rl:test");
    const val1 = await redis.incr("rl:test");
    expect(val1).toBe(1);
  });
});
