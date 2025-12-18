export type TrustScoreMap = Record<string, number>;

export type TrustEventBase = {
  decisionId?: string;
  correlationId?: string;
};

export type TrustFeedback = TrustEventBase & {
  domain: string;
  accepted?: boolean;
  rejected?: boolean;
  reason?: string;
};

export type TrustUpdatedEvent = TrustEventBase & {
  domain: string;
  oldScore: number;
  newScore: number;
  reason: string;
  source?: "feedback" | "implicit" | "system";
  actorUserId?: string;
};

export const DEFAULT_TRUST_BY_DOMAIN: TrustScoreMap = {
  finance: 0.3,
  security: 0.3,
  agenda: 0.6,
  tasks: 0.6,
  messaging: 0.5,
  generic: 0.5,
};

export const ACCEPT_DELTA = 0.1;
export const REJECT_DELTA = -0.15;
export const IMPLICIT_NO_ACTION_REPEAT_DELTA = -0.05;
