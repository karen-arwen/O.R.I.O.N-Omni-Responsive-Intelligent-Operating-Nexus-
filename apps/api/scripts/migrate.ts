import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { Client } from "pg";

const migrationsDir = join(__dirname, "..", "migrations");

const log = (msg: string) => console.log(`[migrate] ${msg}`);

async function ensureSchemaTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations(
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function main() {
  const url = process.env.ORION_DB_URL;
  if (!url) {
    log("ORION_DB_URL not set, skipping migrations (dev mode)");
    return;
  }

  log(`connecting ${url}`);
  const client = new Client({ connectionString: url });
  await client.connect();
  await ensureSchemaTable(client);

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const appliedRes = await client.query<{ version: string }>("SELECT version FROM schema_migrations");
  const applied = new Set(appliedRes.rows.map((r) => r.version));

  for (const file of files) {
    const version = file.replace(".sql", "");
    if (applied.has(version)) {
      log(`skip ${version}`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    log(`applying ${file}`);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [version]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }

  await client.end();
  log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
