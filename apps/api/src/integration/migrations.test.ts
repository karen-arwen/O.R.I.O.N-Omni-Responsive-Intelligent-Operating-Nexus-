import { describe, it, expect, beforeAll } from "vitest";
import { Pool } from "pg";
import { execSync } from "child_process";

const dbUrl = process.env.ORION_DB_URL;
const skip = !dbUrl;

describe.skipIf(skip)("integration: migrations apply", () => {
  const pool = new Pool({ connectionString: dbUrl });

  beforeAll(async () => {
    execSync("npm run migrate:api", { stdio: "inherit" });
  });

  it("creates schema_migrations with applied versions", async () => {
    const res = await pool.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version ASC");
    const versions = res.rows.map((r) => r.version);
    expect(versions).toContain("001_init");
    expect(versions).toContain("002_jobs");
  });

  it("creates tables", async () => {
    const check = async (table: string) => {
      const r = await pool.query(`SELECT to_regclass($1) AS exists`, [table]);
      expect(r.rows[0].exists).toBe(table);
    };
    await check("events");
    await check("jobs");
    await check("schema_migrations");
  });
});
