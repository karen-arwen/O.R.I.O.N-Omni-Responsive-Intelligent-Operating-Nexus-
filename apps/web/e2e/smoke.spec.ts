import { test, expect } from "@playwright/test";

const mockTrust = {
  scoresByDomain: { tasks: 0.72, agenda: 0.61, security: 0.4 },
  defaultsByDomain: { tasks: 0.5, agenda: 0.5, security: 0.3 },
  deltas: { accept: 0.1, reject: -0.15, implicitRepeatNoAction: -0.05 },
  capabilities: { canExecute: false, v: "v0" },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "orion-auth-settings",
      JSON.stringify({ tenantId: "local", token: "e2e-token", userId: "e2e", roles: ["admin", "member"] })
    );
  });

  const now = new Date().toISOString();
  const page1 = [
    {
      id: "evt-1",
      type: "decision.created",
      timestamp: now,
      decisionId: "dec-123",
      correlationId: "corr-1",
      domain: "tasks",
      kind: "decision",
      summary: "Decision created",
      payload: {},
    },
  ];
  const page2 = [
    {
      id: "evt-2",
      type: "decision.suggested",
      timestamp: now,
      decisionId: "dec-456",
      correlationId: "corr-1",
      domain: "tasks",
      kind: "decision",
      summary: "Suggested next step",
      payload: {},
    },
  ];
  const jobs = [
    {
      id: "job-1",
      tenantId: "local",
      createdAt: now,
      updatedAt: now,
      decisionId: "dec-123",
      correlationId: "corr-1",
      domain: "tasks",
      type: "tool.create_note",
      status: "queued",
      priority: 0,
      attempts: 0,
      maxAttempts: 2,
      runAt: now,
      lockedAt: null,
      lockedBy: null,
      idempotencyKey: null,
      input: {},
      output: null,
      error: null,
      traceEventIds: null,
      etag: null,
    },
  ];

  await page.route("**/health", (route) =>
    route.fulfill({ json: { status: "ok", uptime: 1, version: "test", timestamp: new Date().toISOString() } })
  );
  await page.route("**/trust**", (route) => {
    if (route.request().resourceType() !== "fetch" && route.request().resourceType() !== "xhr") return route.continue();
    return route.fulfill({ json: mockTrust });
  });
  await page.route("**/timeline**", (route) => {
    if (route.request().resourceType() !== "fetch" && route.request().resourceType() !== "xhr") return route.continue();
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor");
    if (cursor) {
      return route.fulfill({
        json: { items: page2, nextCursor: null, capabilities: { canExecute: false, v: "v0" } },
      });
    }
    return route.fulfill({
      json: { items: page1, nextCursor: "cursor-1", capabilities: { canExecute: false, v: "v0" } },
    });
  });
  await page.route("**/decisions/dec-123/snapshot", (route) =>
    route.fulfill({
      json: {
        decisionId: "dec-123",
        correlationId: "corr-1",
        snapshot: { intent: { type: "tasks.create", domain: "tasks", action: "create" }, mode: "suggest" },
        events: [],
        capabilities: { canExecute: false, v: "v0" },
        etag: "etag-1",
      },
    })
  );
  await page.route("**/decisions/dec-123/feedback", (route) => {
    if (route.request().resourceType() !== "fetch" && route.request().resourceType() !== "xhr") return route.continue();
    return route.fulfill({
      json: {
        decisionId: "dec-123",
        correlationId: "corr-1",
        domain: "tasks",
        feedback: "accepted",
        trust: { oldScore: 0.5, newScore: 0.6 },
        capabilities: { canExecute: false, v: "v0" },
      },
    });
  });
  await page.route("**/jobs?**", (route) => {
    if (route.request().resourceType() !== "fetch" && route.request().resourceType() !== "xhr") return route.continue();
    return route.fulfill({ json: { jobs, nextCursor: null } });
  });
  await page.route("**/jobs/job-1", (route) => {
    if (route.request().resourceType() !== "fetch" && route.request().resourceType() !== "xhr") return route.continue();
    return route.fulfill({ json: { job: jobs[0] } });
  });
});

test("overview, timeline, and command palette smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Painel Stark")).toBeVisible();

  await page.keyboard.press("Control+KeyK");
  await expect(page.getByPlaceholder("Buscar rota ou ID (dec- / corr- / trust:domain)")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/timeline");
  const correlationInput = page.getByRole("main").getByPlaceholder("correlationId");
  await correlationInput.first().fill("corr-1");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Decision created")).toBeVisible();

  const scroller = page.getByTestId("timeline-scroll");
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.getByText("Suggested next step")).toBeVisible();
});

test("mission, alerts, and decision detail render", async ({ page }) => {
  await page.goto("/mission");
  await expect(page.getByText("Mission Mode")).toBeVisible();

  await page.goto("/alerts");
  await expect(page.getByText("Alerts Center")).toBeVisible();

  await page.goto("/decisions/dec-123");
  await expect(page.getByText("Decisao dec-123")).toBeVisible();
  await expect(page.getByText("Snapshot")).toBeVisible();
});

test("jobs list and detail render", async ({ page }) => {
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await page.getByText("job-1").click();
  await expect(page.getByText("Job job-1")).toBeVisible();
  await expect(page.getByText("Timeline do job")).toBeVisible();
});
