export type RiskLevel = "low" | "medium" | "high";

export type ActorContext = {
  userId: string;
  roles?: string[];
  trustLevel?: number;
  phase?: string;
};

export type EventMeta = {
  actor: ActorContext;
  source: "system" | "user" | "integration";
  correlationId?: string;
  causationId?: string;
  decisionId?: string;
  idempotencyKey?: string;
  phase?: string;
  description?: string;
  tenantId?: string;
};

export type RiskAssessment = {
  level: RiskLevel;
  reasons: string[];
};

export type DomainEvent<TPayload = unknown> = {
  id: string;
  aggregateId: string;
  type: string;
  timestamp: string;
  payload: TPayload;
  meta: EventMeta;
  tags?: string[];
};

export type EventFilter = {
  aggregateId?: string;
  types?: string[];
  since?: string;
  until?: string;
  tags?: string[];
  limit?: number;
  decisionId?: string;
  correlationId?: string;
  tenantId?: string;
};

export * from "./snapshot";

export type TimelineCursor = {
  ts: string;
  id: string;
};
