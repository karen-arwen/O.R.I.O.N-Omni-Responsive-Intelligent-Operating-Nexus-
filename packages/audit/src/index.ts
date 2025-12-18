import { randomUUID } from "crypto";
import { EventStore } from "../../event-store/src";
import { ActorContext, DomainEvent, EventFilter, RiskAssessment, RiskLevel } from "../../shared/src";

export const AUDIT_EVENT_TYPE = "audit.record";

export type AuditStatus = "success" | "failure" | "requires-approval" | "denied";

export type AuditRecordPayload = {
  action: string;
  target: string;
  status: AuditStatus;
  risk: RiskLevel;
  riskReasons?: string[];
  message?: string;
  data?: Record<string, unknown>;
};

export type AuditRecordInput = {
  action: string;
  target: string;
  status: AuditStatus;
  risk?: RiskLevel;
  riskReasons?: string[];
  message?: string;
  data?: Record<string, unknown>;
  actor: ActorContext;
  source?: "system" | "user" | "integration";
  tags?: string[];
  decisionId?: string;
  correlationId?: string;
  riskAssessment?: RiskAssessment;
  tenantId?: string;
};

export class AuditLogger {
  constructor(private readonly store: EventStore) {}

  async record(input: AuditRecordInput): Promise<DomainEvent<AuditRecordPayload>> {
    const event: DomainEvent<AuditRecordPayload> = {
      id: randomUUID(),
      aggregateId: input.actor.userId,
      type: AUDIT_EVENT_TYPE,
      timestamp: new Date().toISOString(),
      payload: {
        action: input.action,
        target: input.target,
        status: input.status,
        risk: input.risk ?? input.riskAssessment?.level ?? "low",
        riskReasons: input.riskReasons ?? input.riskAssessment?.reasons,
        message: input.message,
        data: input.data,
      },
      meta: {
        actor: input.actor,
        source: input.source ?? "system",
        correlationId: input.correlationId ?? input.decisionId,
        decisionId: input.decisionId,
        tenantId: input.tenantId,
      },
      tags: input.tags,
    };

    await this.store.append(event);
    return event;
  }
}

export class AuditQueryService {
  constructor(private readonly store: EventStore) {}

  async list(filter?: EventFilter): Promise<DomainEvent<AuditRecordPayload>[]> {
    const mergedFilter: EventFilter = {
      ...(filter ?? {}),
      types: [AUDIT_EVENT_TYPE],
    };
    return this.store.query(mergedFilter) as Promise<DomainEvent<AuditRecordPayload>[]>;
  }
}
