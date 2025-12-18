export type PlannerSnapshot = {
  intent: {
    type: string;
    domain: string;
    action: string;
    payload?: Record<string, unknown>;
    declaredRisk?: "low" | "medium" | "high";
    declaredRiskReasons?: string[];
  };
  context?: Record<string, unknown>;
  riskAssessment: { level: "low" | "medium" | "high"; reasons: string[] };
  options: any[];
  permission: any;
  recommendedOption?: any;
  mode: string;
  explain: string[];
  capabilities?: { canExecute: boolean; v: string };
  trustUsed?: Record<string, number>;
  snapshotVersion?: number;
  plannerVersion?: string;
};
