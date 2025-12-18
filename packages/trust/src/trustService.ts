import { DomainEvent } from "../../shared/src";
import { EventStore } from "../../event-store/src";
import { randomUUID } from "crypto";
import {
  ACCEPT_DELTA,
  DEFAULT_TRUST_BY_DOMAIN,
  IMPLICIT_NO_ACTION_REPEAT_DELTA,
  REJECT_DELTA,
  TrustFeedback,
  TrustScoreMap,
  TrustUpdatedEvent,
} from "./types";

const TRUST_UPDATED_EVENT = "trust.updated";

const clamp = (v: number): number => Math.min(1, Math.max(0, v));

const resolveDefault = (domain: string): number => {
  if (domain in DEFAULT_TRUST_BY_DOMAIN) return DEFAULT_TRUST_BY_DOMAIN[domain];
  return DEFAULT_TRUST_BY_DOMAIN.generic ?? 0.5;
};

type TrustState = {
  scores: TrustScoreMap;
};

export class TrustService {
  private state: TrustState = { scores: {} };
  private eventStore?: EventStore;

  constructor(deps?: { eventStore?: EventStore }) {
    this.eventStore = deps?.eventStore;
  }

  getTrust(domain: string): number {
    return this.state.scores[domain] ?? resolveDefault(domain);
  }

  recomputeFromEvents(events: DomainEvent[]): TrustScoreMap {
    const scores: TrustScoreMap = {};
    for (const evt of events) {
      if (evt.type !== TRUST_UPDATED_EVENT) continue;
      const payload = evt.payload as TrustUpdatedEvent;
      scores[payload.domain] = payload.newScore;
    }
    this.state.scores = scores;
    return this.state.scores;
  }

  applyFeedback(feedback: TrustFeedback): TrustUpdatedEvent {
    const domain = feedback.domain ?? "generic";
    const current = this.getTrust(domain);
    let delta = 0;
    let reason = feedback.reason ?? "manual";
    if (feedback.accepted) {
      delta = ACCEPT_DELTA;
      reason = "decision.accepted";
    } else if (feedback.rejected) {
      delta = REJECT_DELTA;
      reason = "decision.rejected";
    }
    const next = clamp(current + delta);
    this.state.scores[domain] = next;
    return {
      domain,
      oldScore: current,
      newScore: next,
      reason,
      decisionId: feedback.decisionId,
      correlationId: feedback.correlationId,
      source: feedback.accepted || feedback.rejected ? "feedback" : "system",
      actorUserId: (feedback as any).actorUserId,
    };
  }

  private applyImplicitDelta(domain: string, decisionId?: string, correlationId?: string): TrustUpdatedEvent {
    const current = this.getTrust(domain);
    const next = clamp(current + IMPLICIT_NO_ACTION_REPEAT_DELTA);
    this.state.scores[domain] = next;
    return {
      domain,
      oldScore: current,
      newScore: next,
      reason: "implicit-repeat-no_action",
      decisionId,
      correlationId,
      source: "implicit",
    };
  }

  async applyImplicitRepeatNoAction(params: {
    correlationId: string;
    domain: string;
    decisionId?: string;
    windowLimit?: number;
    tenantId?: string;
  }): Promise<TrustUpdatedEvent | null> {
    if (!this.eventStore) return null;
    const { correlationId, domain, decisionId, windowLimit, tenantId } = params;
    const eventStore = this.eventStore;
    const limit = windowLimit ?? 200;
    // dedupe: check existing trust.updated markers
    const existingTrust = await eventStore.query({
      correlationId,
      types: [TrustEvents.TRUST_UPDATED_EVENT],
      limit: 200,
      tenantId,
    });
    const hasMarker = existingTrust.some(
      (evt) =>
        (evt.payload as any)?.reason === "implicit-repeat-no_action" &&
        (evt.payload as any)?.domain === domain
    );
    if (hasMarker) return null;

    const noActions = await eventStore.query({
      correlationId,
      types: ["system.no_action"],
      limit,
      tenantId,
    });
    const byDomain = noActions.filter((evt) => {
      const payload: any = evt.payload;
      const snapDomain =
        payload?.snapshot?.intent?.domain ?? payload?.intent?.domain ?? payload?.domain ?? payload?.snapshot?.intent?.domain;
      return snapDomain === domain;
    });
    if (byDomain.length < 2) return null;

    const updated = this.applyImplicitDelta(domain, decisionId, correlationId);
    const trustEvent: DomainEvent = {
      id: randomUUID(),
      aggregateId: decisionId ?? correlationId,
      type: TrustEvents.TRUST_UPDATED_EVENT,
      timestamp: new Date().toISOString(),
      payload: updated,
      meta: {
        actor: { userId: "system" },
        source: "system",
        decisionId: decisionId ?? correlationId,
        correlationId,
        tenantId,
      },
      tags: ["trust"],
    };
    await eventStore.append(trustEvent);
    return updated;
  }

  /**
   * @deprecated use applyImplicitRepeatNoAction with constructor-provided eventStore
   */
  async applyImplicitRepeatNoActionWithStore(params: {
    eventStore: EventStore;
    correlationId: string;
    domain: string;
    decisionId?: string;
    windowLimit?: number;
    tenantId?: string;
  }): Promise<TrustUpdatedEvent | null> {
    this.eventStore = params.eventStore;
    return this.applyImplicitRepeatNoAction(params);
  }
}

export const TrustEvents = {
  TRUST_UPDATED_EVENT,
};
