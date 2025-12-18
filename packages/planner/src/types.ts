import { ActorContext, RiskAssessment, RiskLevel } from "../../shared/src";

export type PlannerIntent = {
  type: string;
  payload?: Record<string, unknown>;
  domain: string;
  action: string;
  declaredRisk?: RiskLevel;
  declaredRiskReasons?: string[];
  actor?: ActorContext;
};

export type PlannerContext = {
  actor: ActorContext;
  decisionId?: string;
  correlationId?: string;
  context?: {
    timeOfDay?: string;
    openTasks?: number;
    urgency?: "low" | "medium" | "high";
    phase?: "normal" | "overloaded" | "recovery" | "build" | "creative" | "transition";
    energy?: "low" | "normal" | "high";
    trust?: Record<string, number>;
  };
};

export type PlannerRequest = {
  intent: PlannerIntent;
  actor: ActorContext;
  decisionId: string;
  correlationId: string;
  context?: PlannerContext["context"];
  tenantId?: string;
};

export type PlannerOptionMode = "suggest" | "act" | "no_action_candidate";

export type PlannerOption = {
  optionId: string;
  title: string;
  description: string;
  mode: PlannerOptionMode;
  score: number;
  scoreReasons: string[];
  estimatedImpact?: {
    time?: string;
    energy?: "low" | "medium" | "high";
  };
  estimatedEmotionalImpact?: "unknown" | "low" | "medium" | "high";
};

export type PlannerDecisionMode = "suggest" | "no_action" | "ready_to_execute";

export type PlannerDecisionResult = {
  decisionId: string;
  correlationId: string;
  riskAssessment: RiskAssessment;
  permission: {
    level: "allow" | "deny" | "require-approval";
    requiresApproval: boolean;
    allowed: boolean;
    reason: string;
    policy: string;
    risk: RiskLevel;
    riskReasons: string[];
  };
  options: PlannerOption[];
  recommendedOption?: PlannerOption;
  mode: PlannerDecisionMode;
  explain: string[];
  capabilities: {
    canExecute: boolean;
    v: string;
  };
  trustUsed?: Record<string, number>;
};

export type PlannerSnapshot = {
  intent: PlannerIntent;
  context?: PlannerContext["context"];
  riskAssessment: RiskAssessment;
  options: PlannerOption[];
  permission: PlannerDecisionResult["permission"];
  recommendedOption?: PlannerOption;
  mode: PlannerDecisionMode;
  explain: string[];
  capabilities?: {
    canExecute: boolean;
    v: string;
  };
  trustUsed?: Record<string, number>;
  snapshotVersion?: number;
  plannerVersion?: string;
};
