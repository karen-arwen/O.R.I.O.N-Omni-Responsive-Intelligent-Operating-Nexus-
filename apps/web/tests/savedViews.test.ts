import { describe, expect, it } from "vitest";
import { savedViewSchema } from "../lib/storage/savedViews";
import { buildExplain } from "../lib/explain/buildExplain";

describe("savedViews schema", () => {
  it("validates and serializes", () => {
    const view = { name: "test", filters: { decisionId: "dec-1" }, favorite: true };
    const parsed = savedViewSchema.parse(view);
    expect(parsed.name).toBe("test");
  });
});

describe("buildExplain", () => {
  it("includes deny and low trust bullets", () => {
    const res = buildExplain({
      snapshot: { permission: { level: "deny" }, trustUsed: { tasks: 0.2 }, mode: "no_action" },
      events: [
        {
          id: "e1",
          type: "system.no_action",
          timestamp: new Date().toISOString(),
          decisionId: "d",
          correlationId: "c",
          domain: "tasks",
          kind: "decision",
          summary: "s",
          payload: {},
        },
      ],
    });
    const text = res.bullets.join(" ");
    expect(text).toContain("bloqueou");
    expect(text.toLowerCase()).toContain("baixa confiança");
    expect(text.toLowerCase()).toContain("silêncio");
  });
});
