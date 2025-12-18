"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KINDS = exports.inferDomain = exports.mapKind = exports.sanitizeEventForTimeline = void 0;
const KINDS = {
    DECISION: "decision",
    TRUST: "trust",
    AUDIT: "audit",
    SYSTEM: "system",
    OTHER: "other",
};
exports.KINDS = KINDS;
const mapKind = (event) => {
    if ([
        "decision.created",
        "decision.optioned",
        "decision.suggested",
        "decision.ready_to_execute",
        "system.no_action",
        "decision.accepted",
        "decision.rejected",
    ].includes(event.type)) {
        return KINDS.DECISION;
    }
    if (event.type === "trust.updated")
        return KINDS.TRUST;
    if (event.type.startsWith("audit."))
        return KINDS.AUDIT;
    if (event.type.startsWith("system."))
        return KINDS.SYSTEM;
    return KINDS.OTHER;
};
exports.mapKind = mapKind;
const inferDomain = (event) => {
    const payload = event.payload ?? {};
    const snapDomain = payload?.snapshot?.intent?.domain;
    const intentDomain = payload?.intent?.domain;
    const payloadDomain = payload?.domain;
    return snapDomain ?? intentDomain ?? payloadDomain ?? "generic";
};
exports.inferDomain = inferDomain;
const sanitizeDecisionPayload = (event) => {
    const payload = event.payload ?? {};
    const snapshot = payload.snapshot;
    const intent = snapshot?.intent ?? payload.intent ?? {};
    const permission = snapshot?.permission ?? payload.permission;
    const riskAssessment = snapshot?.riskAssessment ?? payload.riskAssessment;
    const recommendedOption = snapshot?.recommendedOption ?? payload.recommendedOption;
    const explain = (snapshot?.explain ?? payload.explain ?? []).slice(0, 3);
    let mode = snapshot?.mode ?? payload.mode;
    if (!mode) {
        if (event.type === "decision.suggested")
            mode = "suggest";
        else if (event.type === "decision.ready_to_execute")
            mode = "ready_to_execute";
        else if (event.type === "system.no_action")
            mode = "no_action";
    }
    return {
        mode,
        intentType: intent.type,
        domain: intent.domain,
        recommendedOption: recommendedOption
            ? { title: recommendedOption.title, mode: recommendedOption.mode }
            : undefined,
        risk: riskAssessment ? riskAssessment.level : undefined,
        permissionLevel: permission ? permission.level : undefined,
        explain,
        trustUsed: snapshot?.trustUsed
            ? { domains: Object.keys(snapshot.trustUsed).slice(0, 1), score: Object.values(snapshot.trustUsed)[0] }
            : undefined,
    };
};
const sanitizeTrustPayload = (event) => {
    const payload = event.payload ?? {};
    return {
        domain: payload.domain,
        oldScore: payload.oldScore,
        newScore: payload.newScore,
        reason: payload.reason,
        source: payload.source,
    };
};
const sanitizeAuditPayload = (event) => {
    const payload = event.payload ?? {};
    return {
        action: payload.action,
        target: payload.target,
        status: payload.status,
        risk: payload.risk,
    };
};
const sanitizeSystemPayload = (event) => {
    const payload = event.payload ?? {};
    return {
        type: event.type,
        reason: payload.reasonHuman ?? payload.reasonTechnical,
    };
};
const sanitizeGenericPayload = (event) => {
    const payload = event.payload ?? {};
    return {
        type: event.type,
        description: payload.description,
    };
};
const sanitizeEventForTimeline = (event) => {
    const kind = mapKind(event);
    const domain = inferDomain(event);
    let summary = "Evento";
    let payload = {};
    if (kind === "decision") {
        payload = sanitizeDecisionPayload(event);
        summary =
            event.type === "system.no_action"
                ? "Sem ação: silêncio"
                : event.type.startsWith("decision.ready")
                    ? "Decisão pronta para executar (sinalização)"
                    : "Decisão sugerida";
    }
    else if (kind === "trust") {
        payload = sanitizeTrustPayload(event);
        summary =
            payload.reason === "implicit-repeat-no_action"
                ? `Confiança reduzida em ${domain}`
                : `Confiança atualizada em ${domain}`;
    }
    else if (kind === "audit") {
        payload = sanitizeAuditPayload(event);
        summary = "Auditoria registrada";
    }
    else if (kind === "system") {
        payload = sanitizeSystemPayload(event);
        summary = "Evento de sistema";
    }
    else {
        payload = sanitizeGenericPayload(event);
        summary = "Evento";
    }
    return {
        kind,
        domain,
        summary: kind === "decision"
            ? event.type === "decision.created"
                ? "Decisão iniciada"
                : event.type === "decision.optioned"
                    ? "Opções geradas"
                    : event.type === "decision.suggested"
                        ? "Decisão sugerida"
                        : event.type === "decision.ready_to_execute"
                            ? "Decisão pronta (sinalização)"
                            : event.type === "system.no_action"
                                ? "Sem ação (silêncio)"
                                : event.type === "decision.accepted"
                                    ? "Decisão aceita"
                                    : event.type === "decision.rejected"
                                        ? "Decisão rejeitada"
                                        : summary
            : summary,
        payload,
    };
};
exports.sanitizeEventForTimeline = sanitizeEventForTimeline;
