"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOptions = exports.assessRisk = void 0;
const crypto_1 = require("crypto");
const domainRiskDefaults = {
    finance: "high",
    security: "high",
    messages: "medium",
    agenda: "low",
    tasks: "low",
};
const capScore = (value) => Math.min(100, Math.max(0, value));
const assessRisk = (intent) => {
    const reasons = [];
    let level = intent.declaredRisk ??
        domainRiskDefaults[intent.domain] ??
        (intent.action.includes("transfer") || intent.action.includes("payment") ? "high" : "medium");
    if (intent.declaredRiskReasons && intent.declaredRiskReasons.length) {
        reasons.push(...intent.declaredRiskReasons);
    }
    else {
        reasons.push(`domain-${intent.domain || "generic"}`);
    }
    return { level, reasons };
};
exports.assessRisk = assessRisk;
const generateOptions = (intent, ctx) => {
    const baseScore = intent.domain === "agenda" || intent.domain === "tasks" ? 80 : 60;
    const repeatPenalty = ctx.repeatPenalty ? -40 : 0;
    const options = [
        {
            optionId: (0, crypto_1.randomUUID)(),
            title: "Sugestão padrão",
            description: "Apresentar a melhor opção para aprovação",
            mode: "suggest",
            score: capScore(baseScore + repeatPenalty),
            scoreReasons: [
                `base-${baseScore}`,
                ctx.repeatPenalty ? "repeat-in-correlation" : "fresh-decision",
            ],
            estimatedEmotionalImpact: "unknown",
        },
    ];
    // Potential execution candidate (not executed in v0)
    options.push({
        optionId: (0, crypto_1.randomUUID)(),
        title: "Pronto para executar",
        description: "Marcar como executável se políticas permitirem",
        mode: "act",
        score: capScore(baseScore - 10 + repeatPenalty),
        scoreReasons: [
            `base-${baseScore - 10}`,
            ctx.repeatPenalty ? "repeat-in-correlation" : "fresh-decision",
        ],
        estimatedEmotionalImpact: "unknown",
    });
    // No-action candidate
    options.push({
        optionId: (0, crypto_1.randomUUID)(),
        title: "Não agir",
        description: "Escolher silêncio controlado",
        mode: "no_action_candidate",
        score: capScore(30 + repeatPenalty),
        scoreReasons: [
            "baseline-no-action",
            ctx.repeatPenalty ? "repeat-in-correlation" : "manual-no-action",
        ],
        estimatedEmotionalImpact: "low",
    });
    return options.slice(0, 3);
};
exports.generateOptions = generateOptions;
