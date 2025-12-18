import { describe, expect, it } from "vitest";
import { DomainEvent } from "../../shared/src";
import {
  ACCEPT_DELTA,
  DEFAULT_TRUST_BY_DOMAIN,
  IMPLICIT_NO_ACTION_REPEAT_DELTA,
  REJECT_DELTA,
} from "./types";
import { TrustEvents, TrustService } from "./trustService";
import { InMemoryEventStore } from "../../event-store/src";

describe("TrustService", () => {
  it("uses defaults per domain", () => {
    const trust = new TrustService();
    expect(trust.getTrust("finance")).toBe(DEFAULT_TRUST_BY_DOMAIN.finance);
    expect(trust.getTrust("agenda")).toBe(DEFAULT_TRUST_BY_DOMAIN.agenda);
    expect(trust.getTrust("unknown")).toBe(DEFAULT_TRUST_BY_DOMAIN.generic);
  });

  it("accepted increases, rejected decreases, clamped", () => {
    const trust = new TrustService();
    const start = trust.getTrust("tasks");
    const up = trust.applyFeedback({ domain: "tasks", accepted: true });
    expect(up.newScore).toBeCloseTo(start + ACCEPT_DELTA);
    const down = trust.applyFeedback({ domain: "tasks", rejected: true });
    expect(down.newScore).toBeCloseTo(up.newScore + REJECT_DELTA);
  });

  it("clamps to [0,1]", () => {
    const trust = new TrustService();
    // drive low
    let current = trust.getTrust("finance");
    for (let i = 0; i < 20; i++) {
      const evt = trust.applyFeedback({ domain: "finance", rejected: true });
      current = evt.newScore;
    }
    expect(current).toBeGreaterThanOrEqual(0);
    // drive high
    for (let i = 0; i < 20; i++) {
      const evt = trust.applyFeedback({ domain: "finance", accepted: true });
      current = evt.newScore;
    }
    expect(current).toBeLessThanOrEqual(1);
  });

  it("recompute from events uses latest trust.updated", () => {
    const trust = new TrustService();
    const events: DomainEvent[] = [
      {
        id: "1",
        aggregateId: "dec1",
        type: TrustEvents.TRUST_UPDATED_EVENT,
        timestamp: new Date().toISOString(),
        payload: { domain: "tasks", oldScore: 0.5, newScore: 0.6, reason: "a" },
        meta: { actor: { userId: "u" }, source: "system" },
      },
      {
        id: "2",
        aggregateId: "dec2",
        type: TrustEvents.TRUST_UPDATED_EVENT,
        timestamp: new Date(Date.now() + 1000).toISOString(),
        payload: { domain: "tasks", oldScore: 0.6, newScore: 0.7, reason: "b" },
        meta: { actor: { userId: "u" }, source: "system" },
      },
    ];
    trust.recomputeFromEvents(events);
    expect(trust.getTrust("tasks")).toBe(0.7);
  });

  it("implicit repeat no_action reduces trust once per application with dedupe", async () => {
    const store = new InMemoryEventStore();
    const trust = new TrustService({ eventStore: store });
    const correlationId = "corr-implicit";
    const payload = { snapshot: { intent: { domain: "tasks" } } };
    await store.append({
      id: "na1",
      aggregateId: "dec1",
      type: "system.no_action",
      timestamp: new Date().toISOString(),
      payload,
      meta: { actor: { userId: "u" }, source: "system", correlationId },
    } as any);
    await store.append({
      id: "na2",
      aggregateId: "dec2",
      type: "system.no_action",
      timestamp: new Date().toISOString(),
      payload,
      meta: { actor: { userId: "u" }, source: "system", correlationId },
    } as any);

    const before = trust.getTrust("tasks");
    const evt = await trust.applyImplicitRepeatNoAction({ correlationId, domain: "tasks" });
    expect(evt?.newScore).toBeCloseTo(before + IMPLICIT_NO_ACTION_REPEAT_DELTA);

    // dedupe: second call no-op
    const evt2 = await trust.applyImplicitRepeatNoAction({ correlationId, domain: "tasks" });
    expect(evt2).toBeNull();
    const trustEvents = await store.query({ correlationId, types: [TrustEvents.TRUST_UPDATED_EVENT] });
    expect(trustEvents.length).toBe(1);
  });
});
