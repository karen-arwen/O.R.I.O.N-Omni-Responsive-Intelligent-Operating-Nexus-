import { describe, expect, it, beforeEach, vi } from "vitest";
import { apiFetch } from "../lib/api/client";
import { loadAuthSettings, saveAuthSettings } from "../lib/settings/authSettings";

describe("api client headers", () => {
  beforeEach(() => {
    (global as any).localStorage = {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key];
      },
      setItem(key: string, val: string) {
        this.store[key] = val;
      },
      removeItem(key: string) {
        delete this.store[key];
      },
    };
  });

  it("sends tenant and auth headers", async () => {
    saveAuthSettings({ tenantId: "tenant-test", token: "token-123", userId: "u", roles: ["admin"] });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    (global as any).fetch = fetchMock;
    await apiFetch("/health");
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBe("tenant-test");
    expect(headers["Authorization"]).toBe("Bearer token-123");
  });
});
