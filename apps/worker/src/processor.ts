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
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

const truncate = (val: any, max = 4096) => {
  const s = typeof val === "string" ? val : JSON.stringify(val);
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
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

  const canceled = await queue.isCanceled(jobId);
  if (canceled) {
    const canceledJob = await repo.updateStatus(tenantId, jobId, { status: "canceled", lockedAt: null, lockedBy: null });
    await deps.appendEvent({
      id: randomUUID(),
      aggregateId: job.decisionId ?? jobId,
      type: "job.canceled",
      timestamp: new Date().toISOString(),
      payload: {
        jobId,
        jobType: job.type,
        status: "canceled",
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        runAt: job.runAt,
        domain: perm.domain,
        action: perm.action,
        summarySafe: "Job cancelado",
      },
      meta: {
        actor: { userId: "system" },
        source: "system",
        decisionId: job.decisionId ?? jobId,
        correlationId: job.correlationId ?? job.decisionId ?? jobId,
        tenantId,
      },
    });
    return;
  }

  const evaluation = await permissionEngine.evaluate({
    actor,
    domain: perm.domain,
    action: perm.action,
    decisionId: job.decisionId ?? jobId,
    correlationId: job.correlationId ?? job.decisionId ?? jobId,
    context: {},
    risk,
    riskReasons,
  });
  const decision = evaluation.decision.decision;
  if (decision === "deny" || decision === "requires_approval") {
    const code = decision === "deny" ? "permission_denied" : "requires_approval";
    await repo.updateStatus(tenantId, jobId, {
      status: "failed",
      attempts: job.attempts + 1,
      error: { code, message: code },
      lockedAt: null,
      lockedBy: null,
    });
    await deps.appendEvent({
      id: randomUUID(),
      aggregateId: job.decisionId ?? jobId,
      type: "job.failed",
      timestamp: new Date().toISOString(),
      payload: {
        jobId,
        jobType: job.type,
        status: "failed",
        attempts: job.attempts + 1,
        maxAttempts: job.maxAttempts,
        runAt: job.runAt,
        domain: perm.domain,
        action: perm.action,
        summarySafe: code === "requires_approval" ? "Aguardando aprovação" : "Permissão negada",
        errorSafe: { code, message: code },
      },
      meta: {
        actor: { userId: "worker" },
        source: "system",
        decisionId: job.decisionId ?? jobId,
        correlationId: job.correlationId ?? job.decisionId ?? jobId,
        tenantId,
      },
    });
    return;
  }

  const tool = getTool(job.type);
  if (!tool) {
    await repo.updateStatus(tenantId, jobId, {
      status: "dead_letter",
      error: { code: "unknown_tool", message: "Unknown tool" },
      lockedAt: null,
      lockedBy: null,
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
    await deps.appendEvent({
      id: randomUUID(),
      aggregateId: job.decisionId ?? jobId,
      type: "job.succeeded",
      timestamp: new Date().toISOString(),
      payload: {
        jobId,
        jobType: job.type,
        status: "succeeded",
        attempts: job.attempts + 1,
        maxAttempts: job.maxAttempts,
        runAt: job.runAt,
        domain: perm.domain,
        action: perm.action,
        summarySafe: "Job concluído",
        outputSafe: truncate(result.output),
      },
      meta: {
        actor: { userId: "worker" },
        source: "system",
        decisionId: job.decisionId ?? jobId,
        correlationId: job.correlationId ?? job.decisionId ?? jobId,
        tenantId,
      },
    });
  } catch (err: any) {
    const attempts = job.attempts + 1;
    if (attempts >= job.maxAttempts) {
      await repo.updateStatus(tenantId, jobId, {
        status: "dead_letter",
        attempts,
        error: { code: "max_attempts", message: err?.message ?? "error" },
        lockedAt: null,
        lockedBy: null,
      });
      await deps.appendEvent({
        id: randomUUID(),
        aggregateId: job.decisionId ?? jobId,
        type: "job.dead_letter",
        timestamp: new Date().toISOString(),
        payload: {
          jobId,
          jobType: job.type,
          status: "dead_letter",
          attempts,
          maxAttempts: job.maxAttempts,
          runAt: job.runAt,
          domain: perm.domain,
          action: perm.action,
          summarySafe: "Job em dead-letter",
          errorSafe: { message: safeSummary(err?.message ?? "error") },
        },
        meta: {
          actor: { userId: "worker" },
          source: "system",
          decisionId: job.decisionId ?? jobId,
          correlationId: job.correlationId ?? job.decisionId ?? jobId,
          tenantId,
        },
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
      await deps.appendEvent({
        id: randomUUID(),
        aggregateId: job.decisionId ?? jobId,
        type: "job.retried",
        timestamp: new Date().toISOString(),
        payload: {
          jobId,
          jobType: job.type,
          status: "queued",
          attempts,
          maxAttempts: job.maxAttempts,
          runAt: nextRun,
          domain: perm.domain,
          action: perm.action,
          summarySafe: "Job reencaminhado",
          errorSafe: { message: safeSummary(err?.message ?? "retry") },
        },
        meta: {
          actor: { userId: "worker" },
          source: "system",
          decisionId: job.decisionId ?? jobId,
          correlationId: job.correlationId ?? job.decisionId ?? jobId,
          tenantId,
        },
      });
    }
  }
}
