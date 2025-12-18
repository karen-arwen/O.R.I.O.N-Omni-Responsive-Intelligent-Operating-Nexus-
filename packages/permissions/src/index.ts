import { randomUUID } from "crypto";
import { AuditLogger } from "../../audit/src";
import { EventStore } from "../../event-store/src";
import { ActorContext, DomainEvent, RiskLevel } from "../../shared/src";

export type PermissionLevel = "allow" | "deny" | "require-approval";

export type PermissionRule = {
  domain: string;
  action: string;
  level: PermissionLevel;
  risk?: RiskLevel;
  description?: string;
};

export type PermissionRequest = {
  actor: ActorContext;
  domain: string;
  action: string;
  resource?: string;
  context?: Record<string, unknown>;
  risk?: RiskLevel;
  riskReasons?: string[];
  correlationId?: string;
  decisionId?: string;
  tenantId?: string;
};

export type PermissionDecision = {
  allowed: boolean;
  requiresApproval: boolean;
  level: PermissionLevel;
  reason: string;
  risk: RiskLevel;
  riskReasons: string[];
  policy: string;
};

export type PermissionDecisionPayload = PermissionDecision & {
  domain: string;
  action: string;
  resource?: string;
};

export type PermissionDecisionResult = {
  decision: PermissionDecision;
  event: DomainEvent<PermissionDecisionPayload>;
};

export const PERMISSION_DECISION_EVENT = "permission.decision";

export class PermissionEngine {
  private rules: PermissionRule[];

  constructor(
    private readonly store: EventStore,
    private readonly audit: AuditLogger,
    rules?: PermissionRule[]
  ) {
    this.rules = rules ? [...rules] : [];
  }

  private maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
    const order: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };
    return order[a] >= order[b] ? a : b;
  }

  getRules(): PermissionRule[] {
    return [...this.rules];
  }

  cloneWithStore(store: EventStore): PermissionEngine {
    return new PermissionEngine(store, this.audit, this.getRules());
  }

  addRule(rule: PermissionRule): void {
    const existingIndex = this.rules.findIndex(
      (r) => r.domain === rule.domain && r.action === rule.action
    );
    if (existingIndex >= 0) {
      this.rules[existingIndex] = rule;
    } else {
      this.rules.push(rule);
    }
  }

  private selectRule(domain: string, action: string): PermissionRule | undefined {
    const exact = this.rules.find((rule) => rule.domain === domain && rule.action === action);
    if (exact) return exact;
    return this.rules.find((rule) => rule.domain === domain && rule.action === "*");
  }

  async evaluate(request: PermissionRequest): Promise<PermissionDecisionResult> {
    const tenantId = request.tenantId ?? "local";
    const rule = this.selectRule(request.domain, request.action);
    const level: PermissionLevel = rule?.level ?? "require-approval";
    const computedRisk: RiskLevel = rule?.risk ?? "medium";
    const incomingRisk: RiskLevel = request.risk ?? "medium";
    const risk: RiskLevel = this.maxRisk(incomingRisk, computedRisk);
    const riskReasons = [
      ...(request.riskReasons ?? []),
      ...(rule?.risk ? [`policy-${rule.domain}:${rule.action}`] : []),
    ];
    if (riskReasons.length === 0) riskReasons.push("default-policy");

    const decision: PermissionDecision = {
      allowed: level === "allow",
      requiresApproval: level === "require-approval",
      level,
      risk,
      riskReasons,
      reason:
        rule?.description ??
        (level === "allow"
          ? "Allowed by policy"
          : level === "deny"
          ? "Blocked by policy"
          : "Approval required by default policy"),
      policy: rule ? `${rule.domain}:${rule.action}` : "default",
    };

    const payload: PermissionDecisionPayload = {
      ...decision,
      domain: request.domain,
      action: request.action,
      resource: request.resource,
    };

    const event: DomainEvent<PermissionDecisionPayload> = {
      id: randomUUID(),
      aggregateId: request.actor.userId,
      type: PERMISSION_DECISION_EVENT,
      timestamp: new Date().toISOString(),
      payload,
      meta: {
        actor: request.actor,
        source: "system",
        description: "Permission evaluated",
        correlationId: request.correlationId ?? request.decisionId,
        decisionId: request.decisionId,
        tenantId,
      },
      tags: ["permission"],
    };

    await this.store.append(event);

    await this.audit.record({
      action: `permission:${request.domain}.${request.action}`,
      target: request.resource ?? request.domain,
      status:
        decision.level === "deny"
          ? "denied"
          : decision.requiresApproval
          ? "requires-approval"
          : "success",
      risk,
      riskReasons: decision.riskReasons,
      message: decision.reason,
      data: { policy: decision.policy, level: decision.level },
      actor: request.actor,
      tags: ["permission"],
      decisionId: request.decisionId,
      correlationId: request.correlationId,
      riskAssessment: { level: risk, reasons: decision.riskReasons },
      tenantId: request.tenantId,
    });

    return { decision, event };
  }
}
