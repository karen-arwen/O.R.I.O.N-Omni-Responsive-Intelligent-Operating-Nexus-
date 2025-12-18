import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "./server";
import { InMemoryEventStore } from "../../../packages/event-store/src";
import { AuditLogger } from "../../../packages/audit/src";
import { PermissionEngine } from "../../../packages/permissions/src";
import { Planner } from "../../../packages/planner/src/planner";
import { TrustService, TrustEvents } from "../../../packages/trust/src";

describe("API server", () => {
  const decisionId = "dec-api-test";
  let server: ReturnType<typeof buildServer>;
  let store: InMemoryEventStore;

  beforeEach(async () => {
    store = new InMemoryEventStore();
    server = buildServer({ eventStore: store, trustService: new TrustService() });
  });

  it("appends and queries events", async () => {
    const postRes = await server.inject({
      method: "POST",
      url: "/events",
      payload: {
        aggregateId: "agg-1",
        type: "task.created",
        meta: { actor: { userId: "u1" }, source: "user", decisionId },
        payload: { title: "Test" },
      },
    });
    expect(postRes.statusCode).toBe(201);
    const { event } = postRes.json();
    expect(event.meta.decisionId).toBe(decisionId);

    const getRes = await server.inject({
      method: "GET",
      url: `/events?decisionId=${decisionId}`,
    });
    expect(getRes.statusCode).toBe(200);
    const { events } = getRes.json();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(event.id);
  });

  it("evaluates permissions and logs events", async () => {
    const store = new InMemoryEventStore();
    const audit = new AuditLogger(store);
    const engine = new PermissionEngine(store, audit, [
      { domain: "tasks", action: "create", level: "allow", description: "allowed for test" },
    ]);
    server = buildServer({ eventStore: store, auditLogger: audit, permissionEngine: engine });

    const res = await server.inject({
      method: "POST",
      url: "/permissions/evaluate",
      payload: {
        actor: { userId: "u2", roles: ["member"] },
        domain: "tasks",
        action: "create",
        decisionId: "dec-allow",
        riskReasons: ["test-case"],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.decision.allowed).toBe(true);
    expect(body.decisionEventId).toBeDefined();

    const permissionEvents = await store.query({ types: ["permission.decision"], decisionId: "dec-allow" });
    expect(permissionEvents).toHaveLength(1);
  });

  it("returns snapshot from latest final event", async () => {
    const audit = new AuditLogger(store);
    const permissions = new PermissionEngine(store, audit, [
      { domain: "tasks", action: "create", level: "allow", description: "allowed" },
    ]);
    const planner = new Planner({ eventStore: store, audit, permissions });

    await planner.decide({
      intent: { type: "tasks.create", domain: "tasks", action: "create" },
      actor: { userId: "u1" },
      decisionId: "dec-snap",
    });

    // inject a newer final event to ensure "latest" is picked
    const newer = {
      id: "manual-final",
      aggregateId: "dec-snap",
      type: "decision.suggested",
      timestamp: new Date(Date.now() + 2000).toISOString(),
      payload: {
        snapshot: {
          decisionId: "dec-snap",
          correlationId: "dec-snap",
          intent: { type: "tasks.create", domain: "tasks", action: "create" },
          riskAssessment: { level: "medium", reasons: ["manual"] },
          options: [],
          permission: {
            allowed: true,
            requiresApproval: false,
            level: "allow",
            reason: "manual",
            policy: "tasks:create",
            risk: "medium",
            riskReasons: ["manual"],
          },
          mode: "suggest",
          explain: ["manual snapshot"],
        },
      },
      meta: { actor: { userId: "u1" }, source: "planner", decisionId: "dec-snap", correlationId: "dec-snap" },
    };
    await store.append(newer as any);

    const res = await server.inject({
      method: "GET",
      url: "/decisions/dec-snap/snapshot",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.snapshot.explain).toEqual(["manual snapshot"]);
    expect(body.capabilities.canExecute).toBe(false);
  });

  it("returns 404 when decisionId not found", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/decisions/not-found/snapshot",
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when decision incomplete", async () => {
    const created = {
      id: "dec-incomplete-created",
      aggregateId: "dec-incomplete",
      type: "decision.created",
      timestamp: new Date().toISOString(),
      payload: { intent: { type: "x", domain: "y", action: "z" }, actor: { userId: "u1" } },
      meta: { actor: { userId: "u1" }, source: "planner", decisionId: "dec-incomplete", correlationId: "dec-incomplete" },
    };
    await store.append(created as any);

    const res = await server.inject({
      method: "GET",
      url: "/decisions/dec-incomplete/snapshot",
    });
    expect(res.statusCode).toBe(409);
  });

  it("accepts phase/energy/trust context and persists in snapshot", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/planner/decide",
      payload: {
        intent: { type: "agenda.reorder", domain: "agenda", action: "reorder" },
        actor: { userId: "u1" },
        context: { phase: "build", energy: "high", trust: { agenda: 0.7 } },
      },
    });
    expect(res.statusCode).toBe(200);
    const decision = res.json();
    const snapRes = await server.inject({
      method: "GET",
      url: `/decisions/${decision.decisionId}/snapshot`,
    });
    const body = snapRes.json();
    expect(body.snapshot.intent.type).toBe("agenda.reorder");
    expect(body.snapshot.intent.domain).toBe("agenda");
    expect(body.snapshot.context.phase).toBe("build");
    expect(body.snapshot.context.energy).toBe("high");
    expect(body.snapshot.context.trust.agenda).toBe(0.7);
  });

  it("feedback endpoint is idempotent and updates trust", async () => {
    const audit = new AuditLogger(store);
    const permissions = new PermissionEngine(store, audit, [
      { domain: "tasks", action: "create", level: "allow", description: "allowed" },
    ]);
    const trust = new TrustService();
    server = buildServer({ eventStore: store, auditLogger: audit, permissionEngine: permissions, trustService: trust });
    const planner = new Planner({ eventStore: store, audit, permissions, trust });

    await planner.decide({
      intent: { type: "tasks.create", domain: "tasks", action: "create" },
      actor: { userId: "u1" },
      decisionId: "dec-feedback",
    });

    const res1 = await server.inject({
      method: "POST",
      url: "/decisions/dec-feedback/feedback",
      payload: { accepted: true },
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.trust.newScore).toBeDefined();

    const res2 = await server.inject({
      method: "POST",
      url: "/decisions/dec-feedback/feedback",
      payload: { accepted: true },
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.trust).toBeDefined();
    // Idempotent: no second trust update for same decisionId
    const trustEvents = await store.query({ types: ["trust.updated"], decisionId: "dec-feedback" });
    expect(trustEvents.length).toBe(1);
  });

  it("GET /trust returns scores and defaults", async () => {
    const trustEvents = [
      {
        id: "t1",
        aggregateId: "dec-x",
        type: TrustEvents.TRUST_UPDATED_EVENT,
        timestamp: new Date().toISOString(),
        payload: { domain: "tasks", oldScore: 0.5, newScore: 0.6, reason: "manual" },
        meta: { actor: { userId: "u" }, source: "system" },
      },
    ];
    for (const evt of trustEvents) {
      await store.append(evt as any);
    }
    const res = await server.inject({ method: "GET", url: "/trust" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scoresByDomain.tasks).toBe(0.6);
    expect(body.defaultsByDomain.finance).toBeDefined();
  });

  it("GET /trust/:domain returns default when missing", async () => {
    const res = await server.inject({ method: "GET", url: "/trust/unknown-domain" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fromDefault).toBe(true);
    expect(body.score).toBeGreaterThan(0);
  });
});
