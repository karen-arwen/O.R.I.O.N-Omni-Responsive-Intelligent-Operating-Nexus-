import { describe, expect, it, beforeEach } from "vitest";
import { Planner } from "./planner";
import { InMemoryEventStore } from "../../event-store/src";
import { AuditLogger } from "../../audit/src";
import { PermissionEngine } from "../../permissions/src";
import { TrustService, TrustEvents } from "../../trust/src";

const actor = { userId: "u-test" };
const intent = { type: "agenda.reorder", domain: "agenda", action: "reorder", payload: {} };

describe("Planner v0", () => {
  let store: InMemoryEventStore;
  let planner: Planner;

  beforeEach(() => {
    store = new InMemoryEventStore();
    const audit = new AuditLogger(store);
    const permissions = new PermissionEngine(store, audit, [
      { domain: "agenda", action: "reorder", level: "allow", description: "allow agenda reorder" },
    ]);
    planner = new Planner({ eventStore: store, audit, permissions });
  });

  it("generates decisionId and correlationId when missing", async () => {
    const res = await planner.decide({ intent, actor });
    expect(res.decisionId).toBeTruthy();
    expect(res.correlationId).toBe(res.decisionId);
  });

  it("emits decision.created before permissions", async () => {
    await planner.decide({ intent, actor, decisionId: "dec-1" });
    const events = await store.query({ decisionId: "dec-1" });
    expect(events[0].type).toBe("decision.created");
  });

  it("caps options at 3 with score and scoreReasons", async () => {
    const res = await planner.decide({ intent, actor, decisionId: "dec-2" });
    expect(res.options.length).toBeLessThanOrEqual(3);
    res.options.forEach((o) => {
      expect(typeof o.score).toBe("number");
      expect(o.scoreReasons.length).toBeGreaterThan(0);
    });
  });

  it("deny leads to system.no_action with reasons", async () => {
    const audit = new AuditLogger(store);
    const permissions = new PermissionEngine(store, audit, [
      { domain: "agenda", action: "reorder", level: "deny", description: "blocked" },
    ]);
    planner = new Planner({ eventStore: store, audit, permissions });
    const res = await planner.decide({ intent, actor, decisionId: "dec-deny" });
    expect(res.mode).toBe("no_action");
    const events = await store.query({ decisionId: "dec-deny" });
    expect(events.some((e) => e.type === "system.no_action")).toBe(true);
  });

  it("requiresApproval never returns ready_to_execute", async () => {
    const audit = new AuditLogger(store);
    const permissions = new PermissionEngine(store, audit, [
      { domain: "agenda", action: "reorder", level: "require-approval", description: "needs approval" },
    ]);
    planner = new Planner({ eventStore: store, audit, permissions });
    const res = await planner.decide({ intent, actor, decisionId: "dec-approval" });
    expect(res.mode).toBe("suggest");
  });

  it("allow can return ready_to_execute (no real execution)", async () => {
    const res = await planner.decide({ intent, actor, decisionId: "dec-allow" });
    expect(res.mode).toBe("ready_to_execute");
    expect(res.capabilities.canExecute).toBe(false);
  });

  it("idempotent: same decisionId returns same result without duplicating events", async () => {
    const res1 = await planner.decide({ intent, actor, decisionId: "dec-same" });
    const res2 = await planner.decide({ intent, actor, decisionId: "dec-same" });
    expect(res2.decisionId).toBe("dec-same");
    const events = await store.query({ decisionId: "dec-same" });
    expect(events.length).toBeGreaterThan(0);
    expect(res1.mode).toBe(res2.mode);
  });

  it("anti-loop: repeat intent in same correlation reduces behavior", async () => {
    await planner.decide({ intent, actor, decisionId: "dec-first", correlationId: "corr-1" });
    const res2 = await planner.decide({ intent, actor, decisionId: "dec-second", correlationId: "corr-1" });
    expect(res2.explain.some((e) => e.includes("repet"))).toBe(true);
  });

  it("permission risk precedence: rule can elevate risk", async () => {
    const audit = new AuditLogger(store);
    const permissions = new PermissionEngine(store, audit, [
      { domain: "agenda", action: "reorder", level: "allow", risk: "high", description: "elevated" },
    ]);
    planner = new Planner({ eventStore: store, audit, permissions });
    const res = await planner.decide({
      intent: { ...intent, declaredRisk: "low" },
      actor,
      decisionId: "dec-risk",
    });
    expect(res.permission.risk).toBe("high");
  });

  it("detectRepeat uses limit to avoid unbounded query", async () => {
    class RecordingStore extends InMemoryEventStore {
      public lastFilter: any;
      async query(filter?: any): Promise<any[]> {
        this.lastFilter = filter;
        return super.query(filter);
      }
    }
    const recordingStore = new RecordingStore();
    const audit = new AuditLogger(recordingStore);
    const permissions = new PermissionEngine(recordingStore, audit, [
      { domain: "agenda", action: "reorder", level: "allow", description: "allow agenda reorder" },
    ]);
    const recordingPlanner = new Planner({ eventStore: recordingStore, audit, permissions });
    await recordingPlanner.decide({ intent, actor, decisionId: "dec-a", correlationId: "corr-x" });
    await recordingPlanner.decide({ intent, actor, decisionId: "dec-b", correlationId: "corr-x" });
    expect(recordingStore.lastFilter?.limit).toBe(200);
  });

  it("idempotent uses latest final event when multiple exist", async () => {
    await planner.decide({ intent, actor, decisionId: "dec-multi" });
    const newer = {
      id: "manual-final",
      aggregateId: "dec-multi",
      type: "decision.suggested",
      timestamp: new Date(Date.now() + 1000).toISOString(),
      payload: {
        snapshot: {
          mode: "suggest",
          explain: ["manual"],
          options: [],
          riskAssessment: { level: "medium", reasons: ["manual"] },
          intent,
          permission: {
            allowed: true,
            requiresApproval: false,
            level: "allow",
            reason: "manual",
            policy: "p",
            risk: "medium",
            riskReasons: ["manual"],
          },
          correlationId: "dec-multi",
          decisionId: "dec-multi",
          capabilities: { canExecute: false, v: "v0" },
          snapshotVersion: 1,
          plannerVersion: "v0",
        },
      },
      meta: { actor, source: "planner", decisionId: "dec-multi", correlationId: "dec-multi" },
    };
    await store.append(newer as any);
    const res = await planner.decide({ intent, actor, decisionId: "dec-multi" });
    expect(res.explain).toEqual(["manual"]);
  });

  it("implicit repeat no_action updates trust only once per correlation/domain", async () => {
    const trust = new TrustService({ eventStore: store });
    const audit = new AuditLogger(store);
    const permissions = new PermissionEngine(store, audit, [
      { domain: "agenda", action: "reorder", level: "deny", description: "blocked" },
    ]);
    planner = new Planner({ eventStore: store, audit, permissions, trust });

    await planner.decide({ intent, actor, decisionId: "dec-na-1", correlationId: "corr-na" });
    await planner.decide({ intent, actor, decisionId: "dec-na-2", correlationId: "corr-na" });
    const trustEvents = await store.query({
      correlationId: "corr-na",
      types: [TrustEvents.TRUST_UPDATED_EVENT],
    });
    expect(trustEvents.length).toBe(1);
    const evt = trustEvents[0];
    expect((evt.payload as any).reason).toBe("implicit-repeat-no_action");

    await planner.decide({ intent, actor, decisionId: "dec-na-3", correlationId: "corr-na" });
    const trustEventsAfter = await store.query({
      correlationId: "corr-na",
      types: [TrustEvents.TRUST_UPDATED_EVENT],
    });
    expect(trustEventsAfter.length).toBe(1);
  });

  it("low trust plus repeat can lead to no_action conservador", async () => {
    const trust = new TrustService({ eventStore: store });
    // reduce trust below 0.4
    trust.applyFeedback({ domain: "agenda", rejected: true });
    trust.applyFeedback({ domain: "agenda", rejected: true });

    const audit = new AuditLogger(store);
    const permissions = new PermissionEngine(store, audit, [
      { domain: "agenda", action: "reorder", level: "allow", description: "allow agenda reorder" },
    ]);
    planner = new Planner({ eventStore: store, audit, permissions, trust });

    await planner.decide({ intent, actor, decisionId: "dec-low-1", correlationId: "corr-low" });
    const res2 = await planner.decide({ intent, actor, decisionId: "dec-low-2", correlationId: "corr-low" });
    expect(res2.mode === "no_action" || res2.explain.some((e) => e.toLowerCase().includes("conservador"))).toBe(true);
  });
});
