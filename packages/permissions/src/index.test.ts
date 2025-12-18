import { describe, expect, it } from "vitest";
import { InMemoryEventStore } from "../../event-store/src";
import { AuditLogger, AuditQueryService } from "../../audit/src";
import { PermissionEngine } from "./index";

const actor = { userId: "u1", roles: ["member"] };

describe("PermissionEngine", () => {
  it("returns approval required when no rule is present", async () => {
    const store = new InMemoryEventStore();
    const audit = new AuditLogger(store);
    const engine = new PermissionEngine(store, audit);

    const result = await engine.evaluate({
      actor,
      domain: "tasks",
      action: "create",
      resource: "task-1",
      decisionId: "dec-1",
    });

    expect(result.decision.requiresApproval).toBe(true);
    const auditEvents = await new AuditQueryService(store).list();
    expect(auditEvents[0].payload.status).toBe("requires-approval");
  });

  it("allows action when rule is allow", async () => {
    const store = new InMemoryEventStore();
    const audit = new AuditLogger(store);
    const engine = new PermissionEngine(store, audit, [
      { domain: "tasks", action: "create", level: "allow", description: "tasks:create allowed" },
    ]);

    const result = await engine.evaluate({
      actor,
      domain: "tasks",
      action: "create",
    });

    expect(result.decision.allowed).toBe(true);
    expect(result.decision.requiresApproval).toBe(false);
  });

  it("denies action when rule is deny", async () => {
    const store = new InMemoryEventStore();
    const audit = new AuditLogger(store);
    const engine = new PermissionEngine(store, audit, [
      { domain: "finance", action: "*", level: "deny", description: "finance protected" },
    ]);

    const result = await engine.evaluate({
      actor,
      domain: "finance",
      action: "transfer",
    });

    expect(result.decision.allowed).toBe(false);
    expect(result.decision.level).toBe("deny");
  });

  it("elevates risk based on policy", async () => {
    const store = new InMemoryEventStore();
    const audit = new AuditLogger(store);
    const engine = new PermissionEngine(store, audit, [
      { domain: "tasks", action: "create", level: "allow", risk: "high", description: "high risk" },
    ]);

    const result = await engine.evaluate({
      actor,
      domain: "tasks",
      action: "create",
      risk: "low",
      riskReasons: ["incoming-low"],
    });

    expect(result.decision.risk).toBe("high");
    expect(result.decision.riskReasons).toContain("incoming-low");
    expect(result.decision.riskReasons.some((r) => r.includes("policy-tasks:create"))).toBe(true);
  });
});
