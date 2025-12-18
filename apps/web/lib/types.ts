export type TimelineItem = {
  id: string;
  type: string;
  timestamp: string;
  decisionId?: string | null;
  correlationId?: string | null;
  domain: string;
  kind: "decision" | "trust" | "system" | "audit" | "other";
  summary: string;
  payload: Record<string, unknown>;
};
