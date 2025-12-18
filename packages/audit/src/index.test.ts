import { describe, expect, it } from "vitest";
import { InMemoryEventStore } from "../../event-store/src";
import { AuditLogger, AuditQueryService, AUDIT_EVENT_TYPE } from "./index";

describe("AuditLogger", () => {
  it("records audit events and queries them", async () => {
    const store = new InMemoryEventStore();
    const logger = new AuditLogger(store);
    const query = new AuditQueryService(store);

    await logger.record({
      action: "permission:tasks.create",
      target: "tasks",
      status: "success",
      risk: "medium",
      message: "Allowed by policy",
      actor: { userId: "u1", roles: ["admin"] },
      tags: ["permission"],
      decisionId: "dec-123",
    });

    const events = await query.list();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(AUDIT_EVENT_TYPE);
    expect(events[0].payload.action).toBe("permission:tasks.create");
    expect(events[0].meta.decisionId).toBe("dec-123");
  });
});
