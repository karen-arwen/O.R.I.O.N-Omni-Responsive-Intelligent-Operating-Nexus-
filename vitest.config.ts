import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["apps/web/e2e/**", "apps/api/src/integration/**", "node_modules/**", "dist/**", ".next/**"],
  },
});
