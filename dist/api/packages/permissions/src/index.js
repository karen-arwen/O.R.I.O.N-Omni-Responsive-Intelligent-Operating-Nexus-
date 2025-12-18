"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionEngine = exports.PERMISSION_DECISION_EVENT = void 0;
const crypto_1 = require("crypto");
exports.PERMISSION_DECISION_EVENT = "permission.decision";
class PermissionEngine {
    constructor(store, audit, rules) {
        this.store = store;
        this.audit = audit;
        this.rules = rules ? [...rules] : [];
    }
    maxRisk(a, b) {
        const order = { low: 1, medium: 2, high: 3 };
        return order[a] >= order[b] ? a : b;
    }
    getRules() {
        return [...this.rules];
    }
    cloneWithStore(store) {
        return new PermissionEngine(store, this.audit, this.getRules());
    }
    addRule(rule) {
        const existingIndex = this.rules.findIndex((r) => r.domain === rule.domain && r.action === rule.action);
        if (existingIndex >= 0) {
            this.rules[existingIndex] = rule;
        }
        else {
            this.rules.push(rule);
        }
    }
    selectRule(domain, action) {
        const exact = this.rules.find((rule) => rule.domain === domain && rule.action === action);
        if (exact)
            return exact;
        return this.rules.find((rule) => rule.domain === domain && rule.action === "*");
    }
    async evaluate(request) {
        const tenantId = request.tenantId ?? "local";
        const rule = this.selectRule(request.domain, request.action);
        const level = rule?.level ?? "require-approval";
        const computedRisk = rule?.risk ?? "medium";
        const incomingRisk = request.risk ?? "medium";
        const risk = this.maxRisk(incomingRisk, computedRisk);
        const riskReasons = [
            ...(request.riskReasons ?? []),
            ...(rule?.risk ? [`policy-${rule.domain}:${rule.action}`] : []),
        ];
        if (riskReasons.length === 0)
            riskReasons.push("default-policy");
        const decision = {
            allowed: level === "allow",
            requiresApproval: level === "require-approval",
            level,
            risk,
            riskReasons,
            reason: rule?.description ??
                (level === "allow"
                    ? "Allowed by policy"
                    : level === "deny"
                        ? "Blocked by policy"
                        : "Approval required by default policy"),
            policy: rule ? `${rule.domain}:${rule.action}` : "default",
        };
        const payload = {
            ...decision,
            domain: request.domain,
            action: request.action,
            resource: request.resource,
        };
        const event = {
            id: (0, crypto_1.randomUUID)(),
            aggregateId: request.actor.userId,
            type: exports.PERMISSION_DECISION_EVENT,
            timestamp: new Date().toISOString(),
            payload,
            meta: {
                actor: request.actor,
                source: "system",
                description: "Permission evaluated",
                correlationId: request.correlationId ?? request.decisionId,
                decisionId: request.decisionId,
                tenantId,
            },
            tags: ["permission"],
        };
        await this.store.append(event);
        await this.audit.record({
            action: `permission:${request.domain}.${request.action}`,
            target: request.resource ?? request.domain,
            status: decision.level === "deny"
                ? "denied"
                : decision.requiresApproval
                    ? "requires-approval"
                    : "success",
            risk,
            riskReasons: decision.riskReasons,
            message: decision.reason,
            data: { policy: decision.policy, level: decision.level },
            actor: request.actor,
            tags: ["permission"],
            decisionId: request.decisionId,
            correlationId: request.correlationId,
            riskAssessment: { level: risk, reasons: decision.riskReasons },
            tenantId: request.tenantId,
        });
        return { decision, event };
    }
}
exports.PermissionEngine = PermissionEngine;
