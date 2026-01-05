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

  it("maps awaiting approval job and decision events", () => {
    const jobEvt: DomainEvent = {
      id: "2",
      aggregateId: "agg",
      type: "job.awaiting_approval",
      timestamp: new Date().toISOString(),
      payload: { jobId: "job-2", status: "awaiting_approval", domain: "tasks", summarySafe: "need approval" },
      meta: { actor: { userId: "u" }, source: "system", decisionId: "dec-2", tenantId: "t1" },
    };
    const decEvt: DomainEvent = {
      id: "3",
      aggregateId: "dec-2",
      type: "decision.awaiting_approval",
      timestamp: new Date().toISOString(),
      payload: { decisionId: "dec-2", correlationId: "corr-2", domain: "tasks" },
      meta: { actor: { userId: "u" }, source: "system", decisionId: "dec-2", tenantId: "t1" },
    };
    const jobSan = sanitizeEventForTimeline(jobEvt);
    const decSan = sanitizeEventForTimeline(decEvt);
    expect(jobSan.summary.toLowerCase()).toContain("aprov");
    expect(decSan.summary.toLowerCase()).toContain("aprov");
  });

  it("maps approved events safely", () => {
    const jobEvt: DomainEvent = {
      id: "4",
      aggregateId: "agg",
      type: "job.approved",
      timestamp: new Date().toISOString(),
      payload: { jobId: "job-3", status: "queued", summarySafe: "approved" },
      meta: { actor: { userId: "u" }, source: "system", decisionId: "dec-3", tenantId: "t1" },
    };
    const decEvt: DomainEvent = {
      id: "5",
      aggregateId: "dec-3",
      type: "decision.approved",
      timestamp: new Date().toISOString(),
      payload: { decisionId: "dec-3", domain: "tasks" },
      meta: { actor: { userId: "u" }, source: "system", decisionId: "dec-3", tenantId: "t1" },
    };
    const jobSan = sanitizeEventForTimeline(jobEvt);
    const decSan = sanitizeEventForTimeline(decEvt);
    expect(jobSan.kind).toBe("system");
    expect(decSan.kind).toBe("decision");
    expect(jobSan.summary.toLowerCase()).toContain("aprov");
    expect(decSan.summary.toLowerCase()).toContain("aprov");
  });

  it("maps recovered/lock events with summaries", () => {
    const recEvt: DomainEvent = {
      id: "6",
      aggregateId: "agg",
      type: "job.recovered",
      timestamp: new Date().toISOString(),
      payload: { jobId: "job-4", status: "queued", reason: "stale_lock" },
      meta: { actor: { userId: "u" }, source: "system", decisionId: "dec-4", tenantId: "t1" },
    };
    const dupEvt: DomainEvent = {
      id: "7",
      aggregateId: "agg",
      type: "job.duplicate_suppressed",
      timestamp: new Date().toISOString(),
      payload: { jobId: "job-4", summarySafe: "dup" },
      meta: { actor: { userId: "u" }, source: "system", decisionId: "dec-4", tenantId: "t1" },
    };
    const recSan = sanitizeEventForTimeline(recEvt);
    const dupSan = sanitizeEventForTimeline(dupEvt);
    expect(recSan.summary.toLowerCase()).toContain("recuperado");
    expect(dupSan.summary.toLowerCase()).toContain("duplicado");
  });

  it("maps worker heartbeat to system with safe payload", () => {
    const evt: DomainEvent = {
      id: "hb1",
      aggregateId: "worker-tenant",
      type: "worker.heartbeat",
      timestamp: new Date().toISOString(),
      payload: { workerId: "w1", queueDepth: 2, runningCount: 1, activeTenantsCount: 1, ts: new Date().toISOString() },
      meta: { actor: { userId: "worker" }, source: "system", tenantId: "tenant-x" },
    };
    const res = sanitizeEventForTimeline(evt);
    expect(res.kind).toBe("system");
    expect(res.summary.toLowerCase()).toContain("heartbeat");
    expect((res.payload as any).queueDepth).toBe(2);
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

  it("derives outputSafe even when raw output is present", () => {
    const long = "y".repeat(3000);
    const evt: DomainEvent = {
      id: "2",
      aggregateId: "agg",
      type: "tool.echoed",
      timestamp: new Date().toISOString(),
      payload: { jobId: "job-x", output: long },
      meta: { actor: { userId: "u" }, source: "system", decisionId: "dec-2", tenantId: "t1" },
    };
    const res = sanitizeEventForTimeline(evt);
    expect(res.kind).toBe("other");
    expect(((res.payload as any).outputSafe as string).length).toBeLessThan(long.length);
  });
});
