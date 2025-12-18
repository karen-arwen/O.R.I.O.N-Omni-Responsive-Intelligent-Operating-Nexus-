import { describe, expect, it, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { DomainEvent } from "../../shared/src";
import { InMemoryEventStore, JsonFileEventStore } from "./eventStore";

const makeEvent = (aggregateId: string, type: string, tags?: string[]): DomainEvent => ({
  id: `${aggregateId}-${type}`,
  aggregateId,
  type,
  timestamp: new Date().toISOString(),
  payload: {},
  meta: {
    actor: { userId: "tester" },
    source: "system",
    decisionId: "dec-test",
  },
  tags,
});

describe("InMemoryEventStore", () => {
  it("stores and queries events", async () => {
    const store = new InMemoryEventStore();
    await store.append(makeEvent("a1", "task.created", ["task"]));
    await store.append(makeEvent("a1", "task.completed", ["task", "done"]));
    await store.append({
      ...makeEvent("a2", "task.created", ["task"]),
      meta: { actor: { userId: "tester" }, source: "system", decisionId: "other-decision" },
    });

    const a1Events = await store.getByAggregateId("a1");
    expect(a1Events).toHaveLength(2);

    const filtered = await store.query({ types: ["task.completed"], tags: ["done"] });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].type).toBe("task.completed");

    const byDecision = await store.query({ decisionId: "dec-test" });
    expect(byDecision).toHaveLength(2);
  });
});

describe("JsonFileEventStore", () => {
  const filePath = join(process.cwd(), "tmp-event-store.json");

  afterEach(async () => {
    try {
      await fs.rm(filePath);
    } catch {
      // ignore
    }
  });

  it("persists events to disk", async () => {
    const store = new JsonFileEventStore(filePath);
    await store.append(makeEvent("u1", "user.created"));
    await store.append(makeEvent("u1", "user.updated"));

    const persisted = await fs.readFile(filePath, "utf-8");
    const content = JSON.parse(persisted) as DomainEvent[];
    expect(content).toHaveLength(2);

    const storeReloaded = new JsonFileEventStore(filePath);
    const events = await storeReloaded.getByAggregateId("u1");
    expect(events).toHaveLength(2);
  });
});
