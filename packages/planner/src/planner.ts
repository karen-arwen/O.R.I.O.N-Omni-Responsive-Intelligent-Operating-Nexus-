import { randomUUID } from "crypto";
import { AuditLogger } from "../../audit/src";
import { EventStore } from "../../event-store/src";
import { DomainEvent, RiskAssessment } from "../../shared/src";
import { PermissionEngine } from "../../permissions/src";
import { assessRisk, generateOptions } from "./heuristics";
import {
  PlannerDecisionMode,
  PlannerDecisionResult,
  PlannerIntent,
  PlannerOption,
  PlannerRequest,
  PlannerSnapshot,
} from "./types";

const EVENT_DECISION_CREATED = "decision.created";
const EVENT_DECISION_OPTIONED = "decision.optioned";
const EVENT_DECISION_SUGGESTED = "decision.suggested";
const EVENT_DECISION_READY = "decision.ready_to_execute";
const EVENT_NO_ACTION = "system.no_action";

type PlannerDeps = {
  eventStore: EventStore;
  audit: AuditLogger;
  permissions: PermissionEngine;
  trust?: {
    getTrust(domain: string): number;
    applyImplicitRepeatNoAction?: (params: {
      correlationId: string;
      domain: string;
      decisionId?: string;
      windowLimit?: number;
    }) => Promise<any>;
  };
};

export class Planner {
  private store: EventStore;
  private audit: AuditLogger;
  private permissions: PermissionEngine;
  private trust?: { getTrust(domain: string): number; applyImplicitRepeatNoAction?: (params: { correlationId: string; domain: string; decisionId?: string; windowLimit?: number; tenantId?: string }) => Promise<any> };

  constructor(deps: PlannerDeps) {
    this.store = deps.eventStore;
    this.audit = deps.audit;
    this.permissions = deps.permissions;
    this.trust = deps.trust;
  }

  private normalizeRequest(input: {
    intent: PlannerIntent;
    actor: PlannerRequest["actor"];
    decisionId?: string;
    correlationId?: string;
    context?: PlannerRequest["context"];
    tenantId?: string;
  }): PlannerRequest {
    const decisionId = input.decisionId ?? randomUUID();
    const correlationId = input.correlationId ?? decisionId;
    const tenantId = input.tenantId ?? "local";
    return {
      intent: input.intent,
      actor: input.actor,
      decisionId,
      correlationId,
      context: input.context,
      tenantId,
    };
  }

  private async existingDecision(decisionId: string, tenantId?: string): Promise<PlannerSnapshot | null> {
    const events = await this.store.query({ decisionId, tenantId });
    if (!events || events.length === 0) return null;

    const pickLatest = (type: string) =>
      [...events]
        .filter((e) => e.type === type)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

    const created = pickLatest(EVENT_DECISION_CREATED);
    const optioned = pickLatest(EVENT_DECISION_OPTIONED);
    const suggested = pickLatest(EVENT_DECISION_SUGGESTED);
    const ready = pickLatest(EVENT_DECISION_READY);
    const noAction = pickLatest(EVENT_NO_ACTION);

    if (!created || !optioned) return null;

    const finalEvent = suggested ?? ready ?? noAction;
    if (finalEvent && (finalEvent.payload as any)?.snapshot) {
      return (finalEvent.payload as any).snapshot as PlannerSnapshot;
    }

    const snapshot: PlannerSnapshot = {
      intent: (created.payload as any).intent,
      context: (created.payload as any).context,
      riskAssessment: (optioned.payload as any).riskAssessment,
      options: (optioned.payload as any).options,
      permission: (suggested?.payload as any)?.permission ?? (ready?.payload as any)?.permission ?? (noAction?.payload as any)?.permission,
      recommendedOption:
        (suggested?.payload as any)?.recommendedOption ??
        (ready?.payload as any)?.recommendedOption,
      mode: suggested
        ? "suggest"
        : ready
        ? "ready_to_execute"
        : noAction
        ? "no_action"
        : "suggest",
      explain:
        (suggested?.payload as any)?.explain ??
        (ready?.payload as any)?.explain ??
        (noAction?.payload as any)?.explain ??
        [],
    };

    return snapshot;
  }

  private async emit(event: DomainEvent): Promise<void> {
    await this.store.append(event);
  }

  private buildEvent(
    decisionId: string,
    correlationId: string,
    type: string,
    payload: Record<string, unknown>,
    tenantId?: string
  ): DomainEvent {
    return {
      id: randomUUID(),
      aggregateId: decisionId,
      type,
      timestamp: new Date().toISOString(),
      payload,
      meta: {
        actor: payload.actor as any,
        source: "system",
        decisionId,
        correlationId,
        tenantId,
      },
    };
  }

  private pickRecommendedOption(options: PlannerOption[]): PlannerOption | undefined {
    const sorted = [...options].sort((a, b) => b.score - a.score);
    return sorted.find((opt) => opt.mode !== "no_action_candidate") ?? sorted[0];
  }

  private async detectRepeat(correlationId: string, intentType: string, tenantId?: string): Promise<boolean> {
    const events = await this.store.query({
      correlationId,
      types: [EVENT_DECISION_SUGGESTED, EVENT_NO_ACTION, EVENT_DECISION_READY],
      limit: 200,
      tenantId,
    });
    return events.some((evt) => (evt.payload as any)?.intentType === intentType);
  }

  private buildSnapshot(
    req: PlannerRequest,
    riskAssessment: RiskAssessment,
    options: PlannerOption[],
    permission: PlannerDecisionResult["permission"],
    recommendedOption: PlannerOption | undefined,
    mode: PlannerDecisionMode,
    explain: string[]
  ): PlannerSnapshot {
    const trustUsed =
      this.trust && req.intent.domain
        ? { [req.intent.domain]: this.trust.getTrust(req.intent.domain) }
        : req.context?.trust;
    return {
      intent: req.intent,
      context: req.context,
      riskAssessment,
      options,
      permission,
      recommendedOption,
      mode,
      explain,
      capabilities: { canExecute: false, v: "v0" },
      trustUsed,
      snapshotVersion: 1,
      plannerVersion: "v0",
    };
  }

  async decide(input: {
    intent: PlannerIntent;
    actor: PlannerRequest["actor"];
    decisionId?: string;
    correlationId?: string;
    context?: PlannerRequest["context"];
    tenantId?: string;
  }): Promise<PlannerDecisionResult> {
    const req = this.normalizeRequest(input);

    // idempotência
    const existing = await this.existingDecision(req.decisionId, req.tenantId);
    if (existing) {
      return {
        decisionId: req.decisionId,
        correlationId: req.correlationId,
        riskAssessment: existing.riskAssessment,
        permission: existing.permission,
        options: existing.options,
        recommendedOption: existing.recommendedOption,
        mode: existing.mode,
        explain: existing.explain,
        capabilities: existing.capabilities ?? { canExecute: false, v: "v0" },
        trustUsed: existing.trustUsed,
      };
    }

    const createdEvent = this.buildEvent(req.decisionId, req.correlationId, EVENT_DECISION_CREATED, {
      intent: req.intent,
      context: req.context,
      actor: req.actor,
    }, req.tenantId);
    await this.emit(createdEvent);

    const repeatPenalty = await this.detectRepeat(req.correlationId, req.intent.type, req.tenantId);
    const riskAssessment = assessRisk(req.intent);
    const trustScore =
      this.trust?.getTrust(req.intent.domain) ??
      req.context?.trust?.[req.intent.domain] ??
      0.5;
    const optionsRaw = generateOptions(req.intent, { repeatPenalty });
    const options = optionsRaw.map((opt) => {
      let score = opt.score;
      const scoreReasons = [...opt.scoreReasons];
      if (trustScore < 0.4 && opt.mode === "act") {
        score -= 10;
        scoreReasons.push("trust-low-penalty");
      } else if (trustScore > 0.7 && opt.mode !== "no_action_candidate") {
        score += 5;
        scoreReasons.push("trust-high-boost");
      }
      return { ...opt, score: Math.min(100, Math.max(0, score)), scoreReasons };
    });

    const optionedEvent = this.buildEvent(req.decisionId, req.correlationId, EVENT_DECISION_OPTIONED, {
      options,
      riskAssessment,
      actor: req.actor,
      trustUsed: trustScore,
    }, req.tenantId);
    await this.emit(optionedEvent);

    const permissionResult = await this.permissions.evaluate({
      actor: req.actor,
      domain: req.intent.domain,
      action: req.intent.action,
      decisionId: req.decisionId,
      correlationId: req.correlationId,
      risk: riskAssessment.level,
      riskReasons: riskAssessment.reasons,
      tenantId: req.tenantId,
    });

    const permission = {
      ...permissionResult.decision,
    };

    let mode: PlannerDecisionMode = "suggest";
    let recommended = this.pickRecommendedOption(options);
    const explain: string[] = [];

    if (permission.level === "deny") {
      mode = "no_action";
      recommended = undefined;
      explain.push("Permissão negada");
    } else if (permission.requiresApproval) {
      mode = "suggest";
      explain.push("Requer aprovação; apenas sugerindo");
    } else if (permission.allowed) {
      mode = "ready_to_execute";
      explain.push("Permitido e risco aceitável; pronto para executar (não executa no v0)");
    }

    if (repeatPenalty && mode !== "no_action") {
      // anti-loop: reduzir score e potencialmente optar por silêncio
      explain.push("Sugestão similar já feita neste fluxo; sinalizando repetição");
      if (options.every((opt) => opt.mode === "no_action_candidate")) {
        mode = "no_action";
      } else if (mode === "ready_to_execute") {
        // degrade to suggest when repeating
        mode = "suggest";
      }
    }
    if (trustScore < 0.4) {
      explain.push("Baixa confiança neste domínio; sendo conservador");
      if (repeatPenalty) {
        mode = "no_action";
        recommended = undefined;
      }
    } else if (trustScore > 0.7) {
      explain.push("Alta confiança neste domínio; sugestão mais direta");
    }

    const snapshot = this.buildSnapshot(
      req,
      riskAssessment,
      options,
      permission,
      recommended,
      mode,
      explain
    );

    if (mode === "no_action") {
      const noActionEvent = this.buildEvent(req.decisionId, req.correlationId, EVENT_NO_ACTION, {
        intentType: req.intent.type,
        reasonTechnical:
          permission.level === "deny"
            ? "permission-deny"
            : options.every((opt) => opt.mode === "no_action_candidate")
            ? "no-viable-options"
            : "repeat-in-correlation",
        reasonHuman:
          permission.level === "deny"
            ? "Política bloqueou esta ação"
            : options.every((opt) => opt.mode === "no_action_candidate")
            ? "Sem opção segura disponível agora"
            : "Sugestão repetida neste fluxo; mantendo silêncio",
        riskAssessment,
        permission,
        actor: req.actor,
        explain,
        snapshot,
      }, req.tenantId);
      await this.emit(noActionEvent);
    } else {
      const eventType = mode === "ready_to_execute" ? EVENT_DECISION_READY : EVENT_DECISION_SUGGESTED;
      const finalEvent = this.buildEvent(req.decisionId, req.correlationId, eventType, {
        intentType: req.intent.type,
        recommendedOption: recommended,
        riskAssessment,
        permission,
        actor: req.actor,
        explain,
        snapshot,
      }, req.tenantId);
      await this.emit(finalEvent);
    }

    if (mode === "no_action" && this.trust?.applyImplicitRepeatNoAction) {
      await this.trust.applyImplicitRepeatNoAction({
        correlationId: req.correlationId,
        domain: req.intent.domain,
        decisionId: req.decisionId,
        tenantId: req.tenantId,
      });
    }

    return {
      decisionId: req.decisionId,
      correlationId: req.correlationId,
      riskAssessment,
      permission,
      options,
      recommendedOption: recommended,
      mode,
      explain,
      capabilities: { canExecute: false, v: "v0" },
    };
  }
}
