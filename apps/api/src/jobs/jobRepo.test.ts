import { describe, expect, it } from "vitest";
import { InMemoryJobRepository } from "./inMemoryJobRepo";

describe("JobRepository status guards", () => {
  it("prevents terminal overwrite once finalized", async () => {
    const repo = new InMemoryJobRepository();
    const { job } = await repo.createJob("tenant-a", { type: "tool.echo", input: {} });
    await repo.updateStatus("tenant-a", job.id, { status: "succeeded" });
    const after = await repo.updateStatus("tenant-a", job.id, { status: "failed" });
    expect(after?.status).toBe("succeeded");
  });
});
