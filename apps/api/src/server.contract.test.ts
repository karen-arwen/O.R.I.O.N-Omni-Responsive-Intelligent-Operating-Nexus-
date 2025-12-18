import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "./server";
import { InMemoryEventStore } from "../../../packages/event-store/src";
import { AuditLogger } from "../../../packages/audit/src";
import { PermissionEngine } from "../../../packages/permissions/src";
import { Planner } from "../../../packages/planner/src/planner";
import { TrustService } from "../../../packages/trust/src";

describe("API contracts / hardening", () => {
  const decisionId = "dec-contract";
  let server: ReturnType<typeof buildServer>;
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
    const audit = new AuditLogger(store);
    const permissions = new PermissionEngine(store, audit, [
      { domain: "tasks", action: "create", level: "allow", description: "allow" },
    ]);
    const trust = new TrustService({ eventStore: store });
    server = buildServer({ eventStore: store, auditLogger: audit, permissionEngine: permissions, trustService: trust });
  });

  it("serves health and metrics", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const health = res.json();
    expect(health.status).toBe("ok");
    expect(health.version).toBeDefined();

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    expect(metrics.statusCode).toBe(200);
    const body = metrics.json();
    expect(body.routes).toBeInstanceOf(Array);
  });

  it("returns 304 with matching ETag for snapshots", async () => {
    const planner = new Planner({
      eventStore: store,
      audit: new AuditLogger(store),
      permissions: new PermissionEngine(store, new AuditLogger(store)),
    });
    await planner.decide({
      intent: { type: "tasks.create", domain: "tasks", action: "create" },
      actor: { userId: "u1" },
      decisionId,
    });

    const first = await server.inject({ method: "GET", url: `/decisions/${decisionId}/snapshot` });
    expect(first.statusCode).toBe(200);
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^".+"$/);

    const second = await server.inject({
      method: "GET",
      url: `/decisions/${decisionId}/snapshot`,
      headers: { "If-None-Match": etag },
    });
    expect(second.statusCode).toBe(304);
  });

  it("paginates timeline without duplicates and cursor is url-safe", async () => {
    const planner = new Planner({
      eventStore: store,
      audit: new AuditLogger(store),
      permissions: new PermissionEngine(store, new AuditLogger(store)),
      trust: new TrustService({ eventStore: store }),
    });
    await planner.decide({
      intent: { type: "tasks.create", domain: "tasks", action: "create" },
      actor: { userId: "u1" },
      decisionId: "dec-timeline-1",
      correlationId: "corr-1",
    });
    await planner.decide({
      intent: { type: "tasks.create", domain: "tasks", action: "create" },
      actor: { userId: "u1" },
      decisionId: "dec-timeline-2",
      correlationId: "corr-1",
    });

    const res1 = await server.inject({
      method: "GET",
      url: "/timeline",
      query: { correlationId: "corr-1", limit: 1 },
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    const cursor = body1.nextCursor as string;
    expect(cursor).toBeTruthy();
    expect(cursor).not.toContain("+");
    expect(cursor).not.toContain("/");

    const res2 = await server.inject({
      method: "GET",
      url: "/timeline",
      query: { correlationId: "corr-1", cursor },
    });
    expect(res2.statusCode).toBe(200);
    const ids = [...body1.items, ...res2.json().items].map((i: any) => i.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("rejects invalid feedback XOR quickly", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/decisions/dec-x/feedback",
      payload: { accepted: true, rejected: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_feedback");
  });

  it("rate limits per route/ip", async () => {
    const limited = buildServer({
      envOverrides: { ORION_RATE_LIMIT: 1, ORION_RATE_WINDOW_MS: 10_000 },
      eventStore: new InMemoryEventStore(),
    });
    const first = await limited.inject({ method: "GET", url: "/health" });
    expect(first.statusCode).toBe(200);
    const second = await limited.inject({ method: "GET", url: "/health" });
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe("rate_limited");
  });

  it("isolates tenants on timeline", async () => {
    const resA = await server.inject({
      method: "POST",
      url: "/events",
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        aggregateId: "agg-1",
        type: "decision.created",
        meta: { actor: { userId: "u1" }, source: "user", decisionId: "dec-a", correlationId: "corr-a" },
      },
    });
    expect(resA.statusCode).toBe(201);
    const resB = await server.inject({
      method: "POST",
      url: "/events",
      headers: { "x-tenant-id": "tenant-b" },
      payload: {
        aggregateId: "agg-2",
        type: "decision.created",
        meta: { actor: { userId: "u2" }, source: "user", decisionId: "dec-b", correlationId: "corr-b" },
      },
    });
    expect(resB.statusCode).toBe(201);

    const timelineA = await server.inject({
      method: "GET",
      url: "/timeline",
      headers: { "x-tenant-id": "tenant-a" },
      query: { correlationId: "corr-a", limit: 10 },
    });
    expect(timelineA.statusCode).toBe(200);
    expect(timelineA.json().items.length).toBe(1);

    const timelineB = await server.inject({
      method: "GET",
      url: "/timeline",
      headers: { "x-tenant-id": "tenant-b" },
      query: { correlationId: "corr-a", limit: 10 },
    });
    expect(timelineB.statusCode).toBe(200);
    expect(timelineB.json().items.length).toBe(0);
  });

  it("enforces auth when bypass is off", async () => {
    const authServer = buildServer({
      envOverrides: { ORION_DEV_AUTH_BYPASS: "false", ORION_AUTH_TOKENS: "valid-token" },
      eventStore: new InMemoryEventStore(),
    });
    const noAuth = await authServer.inject({ method: "GET", url: "/timeline", query: { decisionId: "x" } });
    expect(noAuth.statusCode).toBe(401);

    const ok = await authServer.inject({
      method: "GET",
      url: "/timeline",
      query: { decisionId: "x" },
      headers: { authorization: "Bearer valid-token" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().items).toEqual([]);
  });
});
