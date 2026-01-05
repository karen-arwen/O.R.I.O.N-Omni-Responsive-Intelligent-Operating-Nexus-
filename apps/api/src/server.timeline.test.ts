import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server";
import { InMemoryEventStore } from "../../../packages/event-store/src";
import { AuditLogger } from "../../../packages/audit/src";
import { PermissionEngine } from "../../../packages/permissions/src";
import { Planner } from "../../../packages/planner/src/planner";
import { TrustService } from "../../../packages/trust/src";

describe("Timeline API", () => {
  let server: ReturnType<typeof buildServer> | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("returns 400 when no filters", async () => {
    server = buildServer({ eventStore: new InMemoryEventStore() });
    const res = await server.inject({ method: "GET", url: "/timeline" });
    expect(res.statusCode).toBe(400);
  });

  it("paginates with cursor and sanitizes", async () => {
    const store = new InMemoryEventStore();
    const audit = new AuditLogger(store);
    const permissions = new PermissionEngine(store, audit, [
      { domain: "tasks", action: "create", level: "allow", description: "allow" },
    ]);
    const trust = new TrustService({ eventStore: store });
    const planner = new Planner({ eventStore: store, audit, permissions, trust });
    server = buildServer({ eventStore: store, auditLogger: audit, permissionEngine: permissions, trustService: trust });

    await planner.decide({
      intent: { type: "tasks.create", domain: "tasks", action: "create" },
      actor: { userId: "u1" },
      decisionId: "dec-tl-1",
      correlationId: "corr-tl",
    });
    await planner.decide({
      intent: { type: "tasks.create", domain: "tasks", action: "create" },
      actor: { userId: "u1" },
      decisionId: "dec-tl-2",
      correlationId: "corr-tl",
    });

    const res1 = await server.inject({
      method: "GET",
      url: "/timeline",
      query: { correlationId: "corr-tl", limit: 1 },
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.items.length).toBe(1);
    expect(body1.items[0].payload).toBeDefined();
    expect(body1.items[0].payload.intent?.payload).toBeUndefined();
    const cursor = body1.nextCursor;
    expect(cursor).toBeTruthy();

    const res2 = await server.inject({
      method: "GET",
      url: "/timeline",
      query: { correlationId: "corr-tl", cursor },
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.items.length).toBeGreaterThan(0);
    expect(body2.items[0].id).not.toBe(body1.items[0].id);
  });

  it("filters by kind and domain", async () => {
    const store = new InMemoryEventStore();
    const audit = new AuditLogger(store);
    const permissions = new PermissionEngine(store, audit, [
      { domain: "tasks", action: "create", level: "allow", description: "allow" },
    ]);
    const trust = new TrustService({ eventStore: store });
    const planner = new Planner({ eventStore: store, audit, permissions, trust });
    const server = buildServer({ eventStore: store, auditLogger: audit, permissionEngine: permissions, trustService: trust });

    await planner.decide({
      intent: { type: "tasks.create", domain: "tasks", action: "create" },
      actor: { userId: "u1" },
      decisionId: "dec-kind",
      correlationId: "corr-kind",
    });

    const res = await server.inject({
      method: "GET",
      url: "/timeline",
      query: { correlationId: "corr-kind", kind: "decision", domain: "tasks" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((it: any) => it.kind === "decision")).toBe(true);
    expect(body.items.every((it: any) => it.domain === "tasks")).toBe(true);
  });
});
