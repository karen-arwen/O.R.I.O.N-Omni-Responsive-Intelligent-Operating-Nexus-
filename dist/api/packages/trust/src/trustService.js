"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrustEvents = exports.TrustService = void 0;
const crypto_1 = require("crypto");
const types_1 = require("./types");
const TRUST_UPDATED_EVENT = "trust.updated";
const clamp = (v) => Math.min(1, Math.max(0, v));
const resolveDefault = (domain) => {
    if (domain in types_1.DEFAULT_TRUST_BY_DOMAIN)
        return types_1.DEFAULT_TRUST_BY_DOMAIN[domain];
    return types_1.DEFAULT_TRUST_BY_DOMAIN.generic ?? 0.5;
};
class TrustService {
    constructor(deps) {
        this.state = { scores: {} };
        this.eventStore = deps?.eventStore;
    }
    getTrust(domain) {
        return this.state.scores[domain] ?? resolveDefault(domain);
    }
    recomputeFromEvents(events) {
        const scores = {};
        for (const evt of events) {
            if (evt.type !== TRUST_UPDATED_EVENT)
                continue;
            const payload = evt.payload;
            scores[payload.domain] = payload.newScore;
        }
        this.state.scores = scores;
        return this.state.scores;
    }
    applyFeedback(feedback) {
        const domain = feedback.domain ?? "generic";
        const current = this.getTrust(domain);
        let delta = 0;
        let reason = feedback.reason ?? "manual";
        if (feedback.accepted) {
            delta = types_1.ACCEPT_DELTA;
            reason = "decision.accepted";
        }
        else if (feedback.rejected) {
            delta = types_1.REJECT_DELTA;
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
            actorUserId: feedback.actorUserId,
        };
    }
    applyImplicitDelta(domain, decisionId, correlationId) {
        const current = this.getTrust(domain);
        const next = clamp(current + types_1.IMPLICIT_NO_ACTION_REPEAT_DELTA);
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
    async applyImplicitRepeatNoAction(params) {
        if (!this.eventStore)
            return null;
        const { correlationId, domain, decisionId, windowLimit, tenantId } = params;
        const eventStore = this.eventStore;
        const limit = windowLimit ?? 200;
        // dedupe: check existing trust.updated markers
        const existingTrust = await eventStore.query({
            correlationId,
            types: [exports.TrustEvents.TRUST_UPDATED_EVENT],
            limit: 200,
            tenantId,
        });
        const hasMarker = existingTrust.some((evt) => evt.payload?.reason === "implicit-repeat-no_action" &&
            evt.payload?.domain === domain);
        if (hasMarker)
            return null;
        const noActions = await eventStore.query({
            correlationId,
            types: ["system.no_action"],
            limit,
            tenantId,
        });
        const byDomain = noActions.filter((evt) => {
            const payload = evt.payload;
            const snapDomain = payload?.snapshot?.intent?.domain ?? payload?.intent?.domain ?? payload?.domain ?? payload?.snapshot?.intent?.domain;
            return snapDomain === domain;
        });
        if (byDomain.length < 2)
            return null;
        const updated = this.applyImplicitDelta(domain, decisionId, correlationId);
        const trustEvent = {
            id: (0, crypto_1.randomUUID)(),
            aggregateId: decisionId ?? correlationId,
            type: exports.TrustEvents.TRUST_UPDATED_EVENT,
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
    async applyImplicitRepeatNoActionWithStore(params) {
        this.eventStore = params.eventStore;
        return this.applyImplicitRepeatNoAction(params);
    }
}
exports.TrustService = TrustService;
exports.TrustEvents = {
    TRUST_UPDATED_EVENT,
};
