const { spawnSync } = require("child_process");

if (!process.env.ORION_DB_URL || !process.env.ORION_REDIS_URL) {
  console.log("integration skipped (set ORION_DB_URL and ORION_REDIS_URL to run)");
  process.exit(0);
}

const res = spawnSync("npx", ["vitest", "run", "--config", "vitest.integration.config.ts"], { stdio: "inherit", shell: true });
process.exit(res.status ?? 1);

