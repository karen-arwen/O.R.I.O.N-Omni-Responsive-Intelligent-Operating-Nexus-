import { describe, it, expect } from "vitest";
import { newDb } from "pg-mem";
import { PostgresEventStore } from "./postgresEventStore";

const setupStore = () => {
  const db = newDb();
  db.public.none(`
    CREATE TABLE events(
      id UUID PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      type TEXT NOT NULL,
      ts TIMESTAMPTZ NOT NULL,
      decision_id TEXT,
      correlation_id TEXT,
      payload JSONB NOT NULL,
      meta JSONB NOT NULL
    );
  `);
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  return new PostgresEventStore({ pool });
};

describe("PostgresEventStore", () => {
  it("appends and queries by tenant and decision", async () => {
    const store = setupStore();
    const ev = {
      id: "00000000-0000-0000-0000-000000000001",
      aggregateId: "agg-1",
      type: "decision.created",
      timestamp: new Date().toISOString(),
      payload: {},
      meta: { actor: { userId: "u1" }, source: "user", decisionId: "dec-1", correlationId: "corr-1", tenantId: "t1" },
    };
    await store.append(ev);
    const results = await store.query({ tenantId: "t1", decisionId: "dec-1" });
    expect(results.length).toBe(1);
    expect(results[0].meta.tenantId).toBe("t1");
  });

  it("respects limit and ordering", async () => {
    const store = setupStore();
    const base = {
      aggregateId: "agg-1",
      type: "decision.created",
      payload: {},
      meta: { actor: { userId: "u1" }, source: "user", decisionId: "dec-1", correlationId: "corr-1", tenantId: "t1" },
    };
    await store.appendMany([
      { ...base, id: "00000000-0000-0000-0000-000000000010", timestamp: "2020-01-01T00:00:00.000Z" },
      { ...base, id: "00000000-0000-0000-0000-000000000020", timestamp: "2020-01-01T00:00:01.000Z" },
    ]);
    const res = await store.query({ tenantId: "t1", limit: 1 });
    expect(res.length).toBe(1);
    expect(res[0].id).toBe("00000000-0000-0000-0000-000000000010");
  });

  it("is idempotent on duplicate ids", async () => {
    const store = setupStore();
    const ev = {
      id: "00000000-0000-0000-0000-000000000099",
      aggregateId: "agg-dup",
      type: "decision.created",
      timestamp: "2022-01-01T00:00:00.000Z",
      payload: {},
      meta: { actor: { userId: "u1" }, source: "user", decisionId: "dec-dup", correlationId: "corr-dup", tenantId: "t1" },
    };
    await store.append(ev);
    await store.append(ev); // should not throw
    const res = await store.query({ tenantId: "t1", aggregateId: "agg-dup" });
    expect(res.length).toBe(1);
    expect(res[0].id).toBe(ev.id);
  });
});
