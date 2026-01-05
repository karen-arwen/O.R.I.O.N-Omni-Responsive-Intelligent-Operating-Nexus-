import { randomUUID } from "crypto";
import { getTool } from "../../../packages/tools/src";
import { jobTypeToPermission, JobRecord } from "../../../packages/shared/src/jobs";
import { DomainEvent, EventStore } from "../../../packages/shared/src";
import { PermissionEngine } from "../../../packages/permissions/src";

export type PermissionResult = "allow" | "deny" | "requires_approval";

export type ProcessorDeps = {
  lockMs: number;
  heartbeatMs?: number;
  backoffMs: number;
  maxAttempts: number;
  appendEvent: (event: DomainEvent) => Promise<void>;
  permissionEngine: PermissionEngine;
  eventStore: EventStore;
  queue: {
    lock: (jobId: string, workerId: string, lockMs: number, tenantId?: string) => Promise<boolean>;
    renewLock?: (jobId: string, workerId: string, lockMs: number, tenantId?: string) => Promise<boolean>;
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

export const ensureIdempotencyKey = (event: DomainEvent, defaultKey?: string): DomainEvent => {
  const isJob = event.type.startsWith("job.");
  const isTool = event.type.startsWith("tool.");
  if (!isJob && !isTool) return event;
  const key = event.meta.idempotencyKey ?? defaultKey;
  if (!key) {
    const msg = "missing idempotencyKey for job/tool event";
    if (process.env.NODE_ENV !== "production") {
      throw new Error(msg);
    } else {
      console.warn(msg, { aggregateId: event.aggregateId, type: event.type });
      event.meta.idempotencyKey = `${event.aggregateId}:${event.type}`;
      return event;
    }
  }
  event.meta.idempotencyKey = key;
  return event;
};

const eventExists = async (store: EventStore, tenantId: string, aggregateId: string, type: string, idempotencyKey: string) => {
  const existing = await store.query({ tenantId, aggregateId, types: [type] });
  return existing.some((e) => (e.meta as any)?.idempotencyKey === idempotencyKey);
};

export async function processJobOnce(tenantId: string, jobId: string, deps: ProcessorDeps): Promise<void> {
  const { queue, repo, workerId, lockMs, backoffMs, permissionEngine } = deps;
  const locked = await queue.lock(jobId, workerId, lockMs, tenantId);
  if (!locked) return;
  const job = await repo.acquireForRun(tenantId, jobId, workerId);
  if (!job) return;

  const perm = jobTypeToPermission(job.type);
  const actor = (job.input as any)?.actor ?? { userId: job.lockedBy ?? "worker" };
  const risk = (job.input as any)?.risk;
  const riskReasons = (job.input as any)?.riskReasons;
  const correlationId = job.correlationId ?? job.decisionId ?? jobId;
  const decisionId = job.decisionId ?? jobId;

  const emit = async (type: string, payload: Record<string, unknown>, opts?: { idKey?: string; dedupe?: boolean }) => {
    const key = opts?.idKey ?? `${jobId}:${type}`;
    const event: DomainEvent = ensureIdempotencyKey({
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
        idempotencyKey: key,
      },
    });
    if (opts?.dedupe !== false && (await eventExists(deps.eventStore, tenantId, decisionId, type, event.meta.idempotencyKey!))) {
      await deps.appendEvent(
        ensureIdempotencyKey({
          ...event,
          type: "job.duplicate_suppressed",
          payload: { jobId, reason: "dedupe", summarySafe: "Evento duplicado evitado" },
          meta: { ...event.meta, idempotencyKey: `${jobId}:job.duplicate_suppressed` },
        })
      );
      return false;
    }
    await deps.appendEvent(event);
    return true;
  };

  const emitDecision = async (type: string, payload: Record<string, unknown>, idKey?: string) => {
    const event: DomainEvent = {
      id: randomUUID(),
      aggregateId: decisionId,
      type,
      timestamp: new Date().toISOString(),
      payload,
      meta: {
        actor: { userId: "worker" },
        source: "system",
        decisionId,
        correlationId,
        tenantId,
        idempotencyKey: idKey,
      },
    };
    if (idKey && (await eventExists(deps.eventStore, tenantId, decisionId, type, idKey))) return false;
    await deps.appendEvent(ensureIdempotencyKey(event, idKey));
    return true;
  };

  const heartbeatMs = deps.heartbeatMs ?? Math.max(1000, Math.floor(lockMs / 3));
  let heartbeatFailed = false;
  let hb: NodeJS.Timeout | null = null;
  if (deps.queue.renewLock) {
    hb = setInterval(async () => {
      const ok = await deps.queue.renewLock!(jobId, workerId, lockMs, tenantId);
      if (!ok) {
        heartbeatFailed = true;
        clearInterval(hb!);
        await emit("job.lock_renew_failed", { jobId, status: job.status, summarySafe: "Falha ao renovar lock" }, `${jobId}:lockfail`);
      }
    }, heartbeatMs);
  }
  const stopHeartbeat = () => {
    if (hb) clearInterval(hb);
  };

  const canceled = await queue.isCanceled(jobId);
  if (canceled) {
    await repo.updateStatus(tenantId, jobId, { status: "canceled", lockedAt: null, lockedBy: null });
    await emit("job.canceled", { status: "canceled", summarySafe: "Job cancelado" }, { idKey: `${jobId}:job.canceled` });
    stopHeartbeat();
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
    }, { idKey: `${jobId}:job.failed` });
    stopHeartbeat();
    return;
  }
  if (decision.requiresApproval && !decision.allowed) {
    await repo.updateStatus(tenantId, jobId, {
      status: "awaiting_approval",
      lockedAt: null,
      lockedBy: null,
      error: { code: "requires_approval", message: decision.reason },
    });
    await emit("job.awaiting_approval", {
      status: "awaiting_approval",
      summarySafe: "Aguardando aprovacao",
      errorSafe: { code: "requires_approval", message: decision.reason },
    }, { idKey: `${jobId}:job.awaiting_approval` });
    if (job.decisionId) {
      await emitDecision("decision.awaiting_approval", {
        decisionId,
        correlationId,
        domain: perm.domain,
        reason: "requires_approval",
        summarySafe: "Aguardando aprovacao",
      }, `${decisionId}:decision.awaiting_approval`);
    }
    stopHeartbeat();
    return;
  }

  const succeededKey = `${jobId}:succeeded`;
  if (await eventExists(deps.eventStore, tenantId, decisionId, "job.succeeded", succeededKey)) {
    await repo.updateStatus(tenantId, jobId, {
      status: "succeeded",
      lockedAt: null,
      lockedBy: null,
    });
    await emit("job.duplicate_suppressed", { jobId, summarySafe: "Reexecucao ignorada" }, { idKey: `${jobId}:job.duplicate_suppressed` }); // visibility
    stopHeartbeat();
    return;
  }

  if (heartbeatFailed) {
    stopHeartbeat();
    return;
  }

  await emit(
    "job.started",
    { status: "running", attempts: job.attempts + 1, summarySafe: "Job iniciado" },
    { idKey: `${jobId}:job.started` }
  );

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
    }, { idKey: `${jobId}:job.dead_letter` });
    stopHeartbeat();
    return;
  }

  try {
    const result = await tool.execute(
      {
        tenantId,
        decisionId: job.decisionId ?? undefined,
        correlationId: job.correlationId ?? job.decisionId ?? jobId,
        actor: { userId: actor?.userId ?? "worker" },
        eventSink: {
          append: async (e: DomainEvent) => {
            const key = (e.meta as any)?.idempotencyKey ?? `${jobId}:${e.type}`;
            const withKey = ensureIdempotencyKey({ ...e, meta: { ...e.meta, idempotencyKey: key, tenantId } }, key);
            const dedupeKey = withKey.meta.idempotencyKey!;
            if (await eventExists(deps.eventStore, tenantId, withKey.aggregateId, withKey.type, dedupeKey)) {
              await deps.appendEvent(
                ensureIdempotencyKey({
                  ...withKey,
                  type: "job.duplicate_suppressed",
                  payload: { jobId, summarySafe: "Tool event deduplicado" },
                  meta: { ...withKey.meta, idempotencyKey: `${jobId}:job.duplicate_suppressed` },
                })
              );
              return;
            }
            await deps.appendEvent(withKey);
          },
        },
      },
      job.input
    );
    if (heartbeatFailed) {
      stopHeartbeat();
      return;
    }
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
    }, { idKey: `${jobId}:job.succeeded` });
    stopHeartbeat();
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
      }, { idKey: `${jobId}:job.dead_letter` });
      stopHeartbeat();
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
      }, { idKey: `${jobId}:job.retried`, dedupe: false });
      stopHeartbeat();
    }
  }
}

export async function recoverStaleJobs(
  tenantId: string,
  staleMs: number,
  deps: {
    repo: { findStaleRunning: (tenantId: string, staleMs: number, limit?: number) => Promise<JobRecord[]>; updateStatus: (tenantId: string, jobId: string, patch: Partial<JobRecord>) => Promise<JobRecord | null>; };
    queue: { enqueue: (job: JobRecord) => Promise<void> };
    emit: (event: DomainEvent) => Promise<void>;
    eventStore: EventStore;
  }
) {
  const stale = await deps.repo.findStaleRunning(tenantId, staleMs, 50);
  for (const job of stale) {
    const nextRun = new Date().toISOString();
    const updated =
      (await deps.repo.updateStatus(tenantId, job.id, {
        status: "queued",
        runAt: nextRun,
        lockedAt: null,
        lockedBy: null,
        error: { code: "stale_lock", message: "Recovered from stale lock" },
      })) ?? job;
    await deps.queue.enqueue({ ...updated, status: "queued", runAt: nextRun } as JobRecord);
    await deps.emit(
      ensureIdempotencyKey({
      id: randomUUID(),
      aggregateId: updated.decisionId ?? updated.id,
      type: "job.recovered",
      timestamp: new Date().toISOString(),
      payload: {
        jobId: updated.id,
        status: "queued",
        reason: "stale_lock",
        runAt: nextRun,
      },
      meta: {
        actor: { userId: "worker" },
        source: "system",
        decisionId: updated.decisionId ?? updated.id,
        correlationId: updated.correlationId ?? updated.decisionId ?? updated.id,
        tenantId,
        idempotencyKey: `${updated.id}:job.recovered`,
      },
    })
    );
  }
}
