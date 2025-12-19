import { randomUUID } from "crypto";
import { getTool } from "../../../packages/tools/src";
import { jobTypeToPermission, JobRecord } from "../../../packages/shared/src/jobs";
import { DomainEvent, EventStore } from "../../../packages/shared/src";
import { PermissionEngine } from "../../../packages/permissions/src";

export type PermissionResult = "allow" | "deny" | "requires_approval";

export type ProcessorDeps = {
  lockMs: number;
  backoffMs: number;
  maxAttempts: number;
  appendEvent: (event: DomainEvent) => Promise<void>;
  permissionEngine: PermissionEngine;
  eventStore: EventStore;
  queue: {
    lock: (jobId: string, workerId: string, lockMs: number) => Promise<boolean>;
    isCanceled: (jobId: string) => Promise<boolean>;
    enqueue: (job: JobRecord) => Promise<void>;
  };
  repo: {
    acquireForRun: (tenantId: string, jobId: string, workerId: string) => Promise<JobRecord | null>;
    updateStatus: (tenantId: string, jobId: string, patch: Partial<JobRecord>) => Promise<JobRecord | null>;
  };
  workerId: string;
};

const safeSummary = (v: any, max = 180) => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}...` : s;
};

const truncate = (val: any, max = 4096) => {
  const s = typeof val === "string" ? val : JSON.stringify(val);
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
};

export async function processJobOnce(tenantId: string, jobId: string, deps: ProcessorDeps): Promise<void> {
  const { queue, repo, workerId, lockMs, backoffMs, permissionEngine } = deps;
  const locked = await queue.lock(jobId, workerId, lockMs);
  if (!locked) return;
  const job = await repo.acquireForRun(tenantId, jobId, workerId);
  if (!job) return;

  const perm = jobTypeToPermission(job.type);
  const actor = (job.input as any)?.actor ?? { userId: job.lockedBy ?? "worker" };
  const risk = (job.input as any)?.risk;
  const riskReasons = (job.input as any)?.riskReasons;
  const correlationId = job.correlationId ?? job.decisionId ?? jobId;
  const decisionId = job.decisionId ?? jobId;

  const emit = async (type: string, payload: Record<string, unknown>) => {
    await deps.appendEvent({
      id: randomUUID(),
      aggregateId: decisionId,
      type,
      timestamp: new Date().toISOString(),
      payload: {
        jobId,
        jobType: job.type,
        status: payload.status ?? job.status,
        attempts: payload.attempts ?? job.attempts,
        maxAttempts: job.maxAttempts,
        runAt: payload.runAt ?? job.runAt,
        domain: perm.domain,
        action: perm.action,
        summarySafe: payload.summarySafe ?? safeSummary(job.type),
        errorSafe: payload.errorSafe,
        outputSafe: payload.outputSafe,
      },
      meta: {
        actor: { userId: "worker" },
        source: "system",
        decisionId,
        correlationId,
        tenantId,
      },
    });
  };

  const canceled = await queue.isCanceled(jobId);
  if (canceled) {
    await repo.updateStatus(tenantId, jobId, { status: "canceled", lockedAt: null, lockedBy: null });
    await emit("job.canceled", { status: "canceled", summarySafe: "Job cancelado" });
    return;
  }

  const evaluation = await permissionEngine.evaluate({
    actor,
    domain: perm.domain,
    action: perm.action,
    decisionId,
    correlationId,
    context: {},
    risk,
    riskReasons,
    tenantId,
  });
  const decision = evaluation.decision;
  if (decision.level === "deny") {
    await repo.updateStatus(tenantId, jobId, {
      status: "failed",
      attempts: job.attempts + 1,
      error: { code: "permission_denied", message: decision.reason },
      lockedAt: null,
      lockedBy: null,
    });
    await emit("job.failed", {
      status: "failed",
      attempts: job.attempts + 1,
      summarySafe: "Permissao negada",
      errorSafe: { code: "permission_denied", message: decision.reason },
    });
    return;
  }
  if (decision.requiresApproval && !decision.allowed) {
    await repo.updateStatus(tenantId, jobId, {
      status: "failed",
      attempts: job.attempts + 1,
      error: { code: "requires_approval", message: decision.reason },
      lockedAt: null,
      lockedBy: null,
    });
    await emit("job.failed", {
      status: "failed",
      attempts: job.attempts + 1,
      summarySafe: "Requer aprovacao",
      errorSafe: { code: "requires_approval", message: decision.reason },
    });
    return;
  }

  await emit("job.started", { status: "running", attempts: job.attempts + 1, summarySafe: "Job iniciado" });

  const tool = getTool(job.type);
  if (!tool) {
    await repo.updateStatus(tenantId, jobId, {
      status: "dead_letter",
      attempts: job.attempts + 1,
      error: { code: "unknown_tool", message: "Unknown tool" },
      lockedAt: null,
      lockedBy: null,
    });
    await emit("job.dead_letter", {
      status: "dead_letter",
      attempts: job.attempts + 1,
      summarySafe: "Tool desconhecida",
      errorSafe: { code: "unknown_tool", message: "Unknown tool" },
    });
    return;
  }

  try {
    const result = await tool.execute(
      {
        tenantId,
        decisionId: job.decisionId ?? undefined,
        correlationId: job.correlationId ?? job.decisionId ?? jobId,
        actor: { userId: actor?.userId ?? "worker" },
        eventSink: { append: (e: DomainEvent) => deps.eventStore.append(e) },
      },
      job.input
    );
    await repo.updateStatus(tenantId, jobId, {
      status: "succeeded",
      attempts: job.attempts + 1,
      output: result.output,
      lockedAt: null,
      lockedBy: null,
      etag: randomUUID(),
      domain: perm.domain,
    });
    await emit("job.succeeded", {
      status: "succeeded",
      attempts: job.attempts + 1,
      summarySafe: "Job concluido",
      outputSafe: truncate(result.output),
    });
  } catch (err: any) {
    const attempts = job.attempts + 1;
    const maxAttempts = job.maxAttempts ?? deps.maxAttempts;
    if (attempts >= maxAttempts) {
      await repo.updateStatus(tenantId, jobId, {
        status: "dead_letter",
        attempts,
        error: { code: "max_attempts", message: err?.message ?? "error" },
        lockedAt: null,
        lockedBy: null,
      });
      await emit("job.dead_letter", {
        status: "dead_letter",
        attempts,
        summarySafe: "Job em dead-letter",
        errorSafe: { code: "max_attempts", message: safeSummary(err?.message ?? "error") },
      });
    } else {
      const next = Math.min(Math.pow(2, attempts) * backoffMs, 5 * 60 * 1000);
      const nextRun = new Date(Date.now() + next).toISOString();
      await repo.updateStatus(tenantId, jobId, {
        status: "queued",
        attempts,
        runAt: nextRun,
        error: { code: "retry", message: safeSummary(err?.message ?? "retry") },
        lockedAt: null,
        lockedBy: null,
      });
      await queue.enqueue({ ...job, status: "queued", attempts, runAt: nextRun } as JobRecord);
      await emit("job.retried", {
        status: "queued",
        attempts,
        runAt: nextRun,
        summarySafe: "Job reencaminhado",
        errorSafe: { code: "retry", message: safeSummary(err?.message ?? "retry") },
      });
    }
  }
}
