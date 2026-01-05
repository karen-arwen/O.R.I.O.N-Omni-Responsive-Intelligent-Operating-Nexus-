import { DomainEvent } from ".";
import { PlannerSnapshot } from "./snapshot";

const KINDS = {
  DECISION: "decision",
  TRUST: "trust",
  AUDIT: "audit",
  SYSTEM: "system",
  OTHER: "other",
} as const;

export type TimelineKind = (typeof KINDS)[keyof typeof KINDS];

const mapKind = (event: DomainEvent): TimelineKind => {
  if (event.type.startsWith("job.")) return KINDS.SYSTEM;
  if (event.type.startsWith("worker.")) return KINDS.SYSTEM;
  if (event.type.startsWith("tool.")) return KINDS.OTHER;
  if (
    [
      "decision.created",
      "decision.optioned",
      "decision.suggested",
      "decision.ready_to_execute",
      "decision.awaiting_approval",
      "decision.approved",
      "system.no_action",
      "decision.accepted",
      "decision.rejected",
    ].includes(event.type)
  ) {
    return KINDS.DECISION;
  }
  if (event.type === "trust.updated") return KINDS.TRUST;
  if (event.type.startsWith("audit.")) return KINDS.AUDIT;
  if (event.type.startsWith("system.")) return KINDS.SYSTEM;
  return KINDS.OTHER;
};

const inferDomain = (event: DomainEvent): string => {
  const payload: any = event.payload ?? {};
  if (payload?.domain) return payload.domain;
  const snapDomain = payload?.snapshot?.intent?.domain;
  const intentDomain = payload?.intent?.domain;
  const payloadDomain = payload?.domain;
  return snapDomain ?? intentDomain ?? payloadDomain ?? "generic";
};

const sanitizeDecisionPayload = (event: DomainEvent) => {
  const payload: any = event.payload ?? {};
  const snapshot: PlannerSnapshot | undefined = payload.snapshot;
  const intent = snapshot?.intent ?? payload.intent ?? {};
  const permission = snapshot?.permission ?? payload.permission;
  const riskAssessment = snapshot?.riskAssessment ?? payload.riskAssessment;
  const recommendedOption = snapshot?.recommendedOption ?? payload.recommendedOption;
  const explain = (snapshot?.explain ?? payload.explain ?? []).slice(0, 3);
  let mode = snapshot?.mode ?? payload.mode;
  if (!mode) {
    if (event.type === "decision.suggested") mode = "suggest";
    else if (event.type === "decision.ready_to_execute") mode = "ready_to_execute";
    else if (event.type === "system.no_action") mode = "no_action";
  }

  return {
    mode,
    intentType: intent.type,
    domain: intent.domain,
    recommendedOption: recommendedOption
      ? { title: (recommendedOption as any).title, mode: (recommendedOption as any).mode }
      : undefined,
    risk: riskAssessment ? riskAssessment.level : undefined,
    permissionLevel: permission ? permission.level : undefined,
    explain,
    trustUsed: snapshot?.trustUsed
      ? { domains: Object.keys(snapshot.trustUsed).slice(0, 1), score: Object.values(snapshot.trustUsed)[0] }
      : undefined,
  };
};

const sanitizeTrustPayload = (event: DomainEvent) => {
  const payload: any = event.payload ?? {};
  return {
    domain: payload.domain,
    oldScore: payload.oldScore,
    newScore: payload.newScore,
    reason: payload.reason,
    source: payload.source,
  };
};

const sanitizeAuditPayload = (event: DomainEvent) => {
  const payload: any = event.payload ?? {};
  return {
    action: payload.action,
    target: payload.target,
    status: payload.status,
    risk: payload.risk,
  };
};

const sanitizeSystemPayload = (event: DomainEvent) => {
  const payload: any = event.payload ?? {};
  return {
    type: event.type,
    reason: payload.reasonHuman ?? payload.reasonTechnical,
  };
};

const sanitizeGenericPayload = (event: DomainEvent) => {
  const payload: any = event.payload ?? {};
  return {
    type: event.type,
    description: payload.description,
  };
};

const truncateSafe = (val: any, max = 2048) => {
  if (val === null || val === undefined) return undefined;
  const s = typeof val === "string" ? val : JSON.stringify(val);
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

export const sanitizeEventForTimeline = (event: DomainEvent) => {
  const kind = mapKind(event);
  const domain = inferDomain(event);
  let summary = "Evento";
  let payload: Record<string, unknown> = {};

  if (kind === "decision") {
    payload = sanitizeDecisionPayload(event);
    summary =
      event.type === "system.no_action"
        ? "Sem ação: silêncio"
        : event.type.startsWith("decision.ready")
        ? "Decisão pronta para executar (sinalização)"
        : "Decisão sugerida";
  } else if (kind === "trust") {
    payload = sanitizeTrustPayload(event);
    summary =
      payload.reason === "implicit-repeat-no_action"
        ? `Confiança reduzida em ${domain}`
        : `Confiança atualizada em ${domain}`;
  } else if (kind === "audit") {
    payload = sanitizeAuditPayload(event);
    summary = "Auditoria registrada";
  } else if (kind === "system") {
    if (event.type.startsWith("job.")) {
      const payloadAny: any = event.payload ?? {};
      const errorRaw = payloadAny?.errorSafe ?? payloadAny?.error;
      payload = {
        jobId: payloadAny?.jobId,
        type: payloadAny?.jobType ?? event.type,
        status: payloadAny?.status,
        attempts: payloadAny?.attempts,
        maxAttempts: payloadAny?.maxAttempts,
        runAt: payloadAny?.runAt,
        domain: payloadAny?.domain ?? domain,
        action: payloadAny?.action,
        summarySafe: truncateSafe(payloadAny?.summarySafe ?? payloadAny?.reasonHuman ?? payloadAny?.reasonTechnical),
        outputSafe: truncateSafe(payloadAny?.outputSafe ?? payloadAny?.output, 2048),
        errorSafe: errorRaw
          ? { ...errorRaw, message: truncateSafe((errorRaw as any)?.message ?? (errorRaw as any)?.reason, 512) }
          : undefined,
      };
      summary =
        event.type === "job.created"
          ? "Job criado"
          : event.type === "job.queued"
          ? "Job enfileirado"
          : event.type === "job.awaiting_approval"
          ? "Job aguardando aprovacao"
          : event.type === "job.approved"
          ? "Job aprovado"
          : event.type === "job.started"
          ? "Job iniciado"
          : event.type === "job.succeeded"
          ? "Job concluido"
          : event.type === "job.failed"
          ? "Job falhou"
          : event.type === "job.retried"
          ? "Job reencaminhado"
          : event.type === "job.dead_letter"
          ? "Job em dead-letter"
          : event.type === "job.canceled"
          ? "Job cancelado"
          : event.type === "job.recovered"
          ? "Job recuperado (stale lock)"
          : event.type === "job.lock_renew_failed"
          ? "Falha ao renovar lock"
          : event.type === "job.duplicate_suppressed"
          ? "Evento duplicado evitado"
          : "Evento de sistema";
    } else if (event.type.startsWith("worker.")) {
      const payloadAny: any = event.payload ?? {};
      payload = {
        workerId: payloadAny?.workerId,
        ts: payloadAny?.ts,
        queueDepth: payloadAny?.queueDepth,
        runningCount: payloadAny?.runningCount,
        activeTenantsCount: payloadAny?.activeTenantsCount,
      };
      summary = "Worker heartbeat";
    } else {
      payload = sanitizeSystemPayload(event);
      summary = "Evento de sistema";
    }
  } else if (event.type.startsWith("tool.")) {
    const payloadAny: any = event.payload ?? {};
    payload = {
      jobId: payloadAny?.jobId,
      tool: event.type,
      summarySafe: truncateSafe(payloadAny?.summarySafe ?? payloadAny?.description ?? payloadAny?.echo),
      outputSafe: truncateSafe(payloadAny?.outputSafe ?? payloadAny?.output, 2048),
      domain: payloadAny?.domain ?? domain,
    };
    summary =
      event.type === "tool.echoed"
        ? "Tool: echo"
        : event.type === "tool.note_created"
        ? "Tool: nota criada"
        : event.type === "tool.task_stub_created"
        ? "Tool: tarefa criada"
        : event.type === "tool.draft_generated"
        ? "Tool: rascunho gerado"
        : event.type === "tool.bundle_exported"
        ? "Tool: bundle exportado"
        : "Tool";
  } else {
    payload = sanitizeGenericPayload(event);
    summary =
      event.type === "decision.awaiting_approval"
        ? "Decisão aguarda aprovação"
        : event.type === "decision.approved"
        ? "Decisão aprovada"
        : "Evento";
  }

  return {
    kind,
    domain,
    summary:
      kind === "decision"
        ? event.type === "decision.created"
          ? "Decisão iniciada"
          : event.type === "decision.optioned"
          ? "Opções geradas"
          : event.type === "decision.suggested"
          ? "Decisão sugerida"
          : event.type === "decision.ready_to_execute"
          ? "Decisão pronta (sinalização)"
          : event.type === "decision.awaiting_approval"
          ? "Decisão aguarda aprovação"
          : event.type === "decision.approved"
          ? "Decisão aprovada"
          : event.type === "system.no_action"
          ? "Sem ação (silêncio)"
          : event.type === "decision.accepted"
          ? "Decisão aceita"
          : event.type === "decision.rejected"
          ? "Decisão rejeitada"
          : summary
        : summary,
    payload,
  };
};

export { mapKind, inferDomain, KINDS };
