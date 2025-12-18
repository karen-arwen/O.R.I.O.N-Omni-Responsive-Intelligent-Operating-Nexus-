import "dotenv/config";
import Redis from "ioredis";
import { Pool } from "pg";
import { JobRepository } from "../../api/src/jobs/jobRepo";
import { JobQueue } from "../../api/src/jobs/queue";
import { PermissionEngine } from "../../../packages/permissions/src";
import { AuditLogger } from "../../../packages/audit/src";
import { PostgresEventStore } from "../../../packages/event-store/src/postgresEventStore";
import { DomainEvent, EventStore } from "../../../packages/shared/src";
import { JobRecord } from "../../../packages/shared/src/jobs";
import { processJobOnce } from "./processor";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const env = {
  dbUrl: process.env.ORION_DB_URL,
  redisUrl: process.env.ORION_REDIS_URL,
  concurrency: Number(process.env.ORION_WORKER_CONCURRENCY ?? 4),
  pollMs: Number(process.env.ORION_WORKER_POLL_MS ?? 500),
  lockMs: Number(process.env.ORION_WORKER_LOCK_MS ?? 30000),
  tenantFilter: process.env.ORION_WORKER_TENANTS ?? "*",
  maxAttempts: Number(process.env.ORION_JOB_MAX_ATTEMPTS ?? 5),
  backoffMs: Number(process.env.ORION_JOB_BACKOFF_MS ?? 1000),
};

const tenantRegex = /^[a-z0-9_-]{1,32}$/;
const filterTenants = (candidates: string[]): string[] => {
  const raw = env.tenantFilter;
  if (raw === "*" || raw === "") {
    return candidates;
  }
  if (raw.startsWith("re:")) {
    const re = new RegExp(raw.slice(3));
    return candidates.filter((t) => re.test(t));
  }
  const allow = new Set(raw.split(",").map((t) => t.trim()).filter(Boolean));
  if (allow.has("*")) return candidates;
  return candidates.filter((t) => allow.has(t));
};

const tenantScopedStore = (base: EventStore, tenantId: string): EventStore => {
  return {
    append: async (event) =>
      base.append({
        ...event,
        meta: { ...(event.meta as any), tenantId, correlationId: event.meta.correlationId ?? event.meta.decisionId },
      }),
    appendMany: async (events) =>
      base.appendMany(
        events.map((event) => ({
          ...event,
          meta: { ...(event.meta as any), tenantId, correlationId: event.meta.correlationId ?? event.meta.decisionId },
        }))
      ),
    query: async (filter) => base.query({ ...filter, tenantId }),
    getByAggregateId: async (aggregateId) => (base.getByAggregateId ? base.getByAggregateId(aggregateId) : []),
  };
};

async function main() {
  if (!env.dbUrl) {
    console.error("ORION_DB_URL not set for worker");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: env.dbUrl });
  const eventStore = new PostgresEventStore({ pool });
  const repo = new JobRepository(pool);
  const redis = env.redisUrl ? new Redis(env.redisUrl) : null;
  if (!redis) {
    console.error("Redis required for worker");
    process.exit(1);
  }
  const queue = new JobQueue(redis);
  const workerId = `worker-${randomUUID()}`;

  console.log(`[worker] started id=${workerId} concurrency=${env.concurrency}`);

  let cachedTenants: { ts: number; tenants: string[] } | null = null;
  const discoverTenants = async () => {
    const now = Date.now();
    if (cachedTenants && now - cachedTenants.ts < 10_000) return cachedTenants.tenants;
    const res = await pool.query(
      `SELECT DISTINCT tenant_id FROM jobs WHERE status IN ('queued','running') ORDER BY tenant_id ASC LIMIT 200`
    );
    let tenants = res.rows
      .map((r: any) => String(r.tenant_id))
      .filter((t) => tenantRegex.test(t));
    try {
      const ev = await pool.query(`SELECT DISTINCT (meta->>'tenantId') AS tenant_id FROM events LIMIT 50`);
      tenants = tenants.concat(
        ev.rows
          .map((r: any) => String(r.tenant_id ?? "")) //
          .filter((t) => tenantRegex.test(t))
      );
    } catch {
      /* optional */
    }
    const filtered = Array.from(new Set(filterTenants(tenants)));
    const finalTenants = filtered.length ? filtered : ["local"];
    cachedTenants = { ts: now, tenants: finalTenants };
    return finalTenants;
  };

  while (true) {
    const tenants = await discoverTenants();
    const work: Promise<void>[] = [];
    for (const tenantId of tenants) {
      const readyIds = await queue.dequeueReady(tenantId, env.concurrency);
      for (const jobId of readyIds) {
        if (work.length >= env.concurrency) break;
        const tenantStore = tenantScopedStore(eventStore, tenantId);
        const permEngine = new PermissionEngine(tenantStore, new AuditLogger(tenantStore));
        const tenantEventAppender = async (event: DomainEvent) => {
          await tenantStore.append(event);
        };
        work.push(
          processJobOnce(tenantId, jobId, {
            lockMs: env.lockMs,
            backoffMs: env.backoffMs,
            maxAttempts: env.maxAttempts,
            appendEvent: tenantEventAppender,
            permissionEngine: permEngine,
            eventStore: tenantStore,
            queue: {
              lock: (jid, wid, lockMs) => queue.lock(`${tenantId}:${jid}`, wid, lockMs),
              isCanceled: (jid) => queue.isCanceled(jid),
              enqueue: (job) => queue.enqueue(job),
            },
            repo,
            workerId,
          })
        );
      }
    }
    if (work.length) {
      await Promise.allSettled(work);
    } else {
      await sleep(env.pollMs);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
