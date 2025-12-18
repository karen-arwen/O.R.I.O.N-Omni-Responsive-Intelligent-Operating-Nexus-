"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditQueryService = exports.AuditLogger = exports.AUDIT_EVENT_TYPE = void 0;
const crypto_1 = require("crypto");
exports.AUDIT_EVENT_TYPE = "audit.record";
class AuditLogger {
    constructor(store) {
        this.store = store;
    }
    async record(input) {
        const event = {
            id: (0, crypto_1.randomUUID)(),
            aggregateId: input.actor.userId,
            type: exports.AUDIT_EVENT_TYPE,
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
exports.AuditLogger = AuditLogger;
class AuditQueryService {
    constructor(store) {
        this.store = store;
    }
    async list(filter) {
        const mergedFilter = {
            ...(filter ?? {}),
            types: [exports.AUDIT_EVENT_TYPE],
        };
        return this.store.query(mergedFilter);
    }
}
exports.AuditQueryService = AuditQueryService;
