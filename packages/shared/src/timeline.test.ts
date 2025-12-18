import { describe, expect, it } from "vitest";
import { sanitizeEventForTimeline, inferDomain, mapKind } from "./timeline";
import { DomainEvent } from ".";

const baseEvent = (override: Partial<DomainEvent>): DomainEvent => ({
  id: "e1",
  aggregateId: "agg",
  type: "decision.suggested",
  timestamp: new Date().toISOString(),
  payload: {},
  meta: { actor: { userId: "u" }, source: "system" },
  ...override,
});

describe("timeline helpers", () => {
  it("maps kind decision and sanitizes", () => {
    const evt = baseEvent({
      type: "decision.suggested",
      payload: { snapshot: { intent: { type: "x", domain: "tasks" }, explain: ["a", "b"] } },
    });
    const res = sanitizeEventForTimeline(evt);
    expect(res.kind).toBe("decision");
    expect(res.domain).toBe("tasks");
    expect(res.payload.intentType).toBe("x");
    expect(res.payload.explain.length).toBeLessThanOrEqual(3);
  });

  it("infers domain with fallback", () => {
    const evt = baseEvent({ payload: { domain: "finance" } });
    expect(inferDomain(evt)).toBe("finance");
    const evt2 = baseEvent({ payload: {} });
    expect(inferDomain(evt2)).toBe("generic");
  });

  it("maps system.no_action to decision kind", () => {
    const evt = baseEvent({ type: "system.no_action" });
    expect(mapKind(evt)).toBe("decision");
  });

  it("maps job events to system kind and sanitizes payload", () => {
    const evt: DomainEvent = {
      id: "1",
      aggregateId: "agg",
      type: "job.failed",
      timestamp: new Date().toISOString(),
      payload: {
        jobId: "job-1",
        jobType: "tool.create_note",
        status: "failed",
        attempts: 2,
        maxAttempts: 3,
        runAt: new Date().toISOString(),
        domain: "tasks",
        action: "create",
        summarySafe: "Permissão negada",
        errorSafe: { code: "permission_denied", message: "permission_denied" },
      },
      meta: { actor: { userId: "u" }, source: "system", decisionId: "dec-1", tenantId: "t1" },
    };
    const res = sanitizeEventForTimeline(evt);
    expect(res.kind).toBe("system");
    expect(res.payload.domain).toBe("tasks");
    expect((res.payload as any).errorSafe.code).toBe("permission_denied");
  });

  it("maps tool events to other kind and truncates output", () => {
    const long = "x".repeat(5000);
    const evt: DomainEvent = {
      id: "1",
      aggregateId: "agg",
      type: "tool.echoed",
      timestamp: new Date().toISOString(),
      payload: { jobId: "job-2", summarySafe: "ok", outputSafe: long },
      meta: { actor: { userId: "u" }, source: "system", decisionId: "dec-1", tenantId: "t1" },
    };
    const res = sanitizeEventForTimeline(evt);
    expect(res.kind).toBe("other");
    expect(((res.payload as any).outputSafe as string).length).toBeLessThan(long.length);
  });
});
