import { Pool } from "pg";
import { randomUUID } from "crypto";
import { JobCreateInput, JobRecord, JobStatus, JobUpdatePatch, jobTypeToPermission } from "../../../../packages/shared/src/jobs";

const statusOrder: JobStatus[] = ["queued", "running", "awaiting_approval", "succeeded", "failed", "canceled", "dead_letter"];

const normalizeDate = (v?: string | Date) => (v ? new Date(v).toISOString() : new Date().toISOString());

export class JobRepository {
  constructor(private pool: Pool) {}

  private mapRow(row: any): JobRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      decisionId: row.decision_id,
      correlationId: row.correlation_id,
      domain: row.domain,
      type: row.type,
      status: row.status,
      priority: row.priority,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      runAt: row.run_at.toISOString(),
      lockedAt: row.locked_at ? row.locked_at.toISOString() : null,
      lockedBy: row.locked_by,
      idempotencyKey: row.idempotency_key,
      input: row.input,
      output: row.output,
      error: row.error,
      traceEventIds: row.trace_event_ids,
      etag: row.etag,
    };
  }

  async createJob(tenantId: string, input: JobCreateInput): Promise<{ job: JobRecord; created: boolean }> {
    const id = randomUUID();
    const now = normalizeDate();
    const runAt = normalizeDate(input.runAt);
    const maxAttempts = input.maxAttempts ?? 5;
    const priority = input.priority ?? 0;
    const idempotency = input.idempotencyKey ?? null;
    const inferred = jobTypeToPermission(input.type);
    const domain = input.domain ?? inferred.domain;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (idempotency) {
        const existing = await client.query("SELECT * FROM jobs WHERE tenant_id=$1 AND idempotency_key=$2", [
          tenantId,
          idempotency,
        ]);
        if ((existing.rowCount ?? 0) > 0) {
          await client.query("COMMIT");
          return { job: this.mapRow(existing.rows[0]), created: false };
        }
      }
      const res = await client.query(
        `
        INSERT INTO jobs(
          id, tenant_id, created_at, updated_at, decision_id, correlation_id, domain, type, status, priority,
          attempts, max_attempts, run_at, locked_at, locked_by, idempotency_key, input, output, error, trace_event_ids, etag
        ) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,NULL,$13,$14,NULL,NULL,NULL,NULL)
        RETURNING *
      `,
        [
          id,
          tenantId,
          now,
          input.decisionId ?? null,
          input.correlationId ?? null,
          domain,
          input.type,
          input.status ?? ("queued" as JobStatus),
          priority,
          0,
          maxAttempts,
          runAt,
          idempotency,
          JSON.stringify(input.input ?? {}),
        ]
      );
      await client.query("COMMIT");
      return { job: this.mapRow(res.rows[0]), created: true };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getJob(tenantId: string, jobId: string): Promise<JobRecord | null> {
    const res = await this.pool.query("SELECT * FROM jobs WHERE tenant_id=$1 AND id=$2", [tenantId, jobId]);
    return res.rowCount ? this.mapRow(res.rows[0]) : null;
  }

  async findLatestByDecision(tenantId: string, decisionId: string, statuses?: JobStatus[]): Promise<JobRecord | null> {
    const values: any[] = [tenantId, decisionId];
    let where = "tenant_id=$1 AND decision_id=$2";
    if (statuses && statuses.length > 0) {
      values.push(statuses);
      where += ` AND status = ANY($${values.length})`;
    }
    const res = await this.pool.query(
      `SELECT * FROM jobs WHERE ${where} ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
      values
    );
    return res.rowCount ? this.mapRow(res.rows[0]) : null;
  }

  async listJobs(
    tenantId: string,
    filters: {
      status?: JobStatus;
      decisionId?: string;
      correlationId?: string;
      domain?: string;
      type?: string;
    },
    cursor?: { runAt: string; id: string },
    limit = 50
  ): Promise<{ jobs: JobRecord[]; nextCursor: string | null }> {
    const values: any[] = [tenantId];
    const where: string[] = ["tenant_id=$1"];
    if (filters.status) {
      values.push(filters.status);
      where.push(`status=$${values.length}`);
    }
    if (filters.decisionId) {
      values.push(filters.decisionId);
      where.push(`decision_id=$${values.length}`);
    }
    if (filters.correlationId) {
      values.push(filters.correlationId);
      where.push(`correlation_id=$${values.length}`);
    }
    if (filters.domain) {
      values.push(filters.domain);
      where.push(`domain=$${values.length}`);
    }
    if (filters.type) {
      values.push(filters.type);
      where.push(`type=$${values.length}`);
    }
    if (cursor) {
      values.push(cursor.runAt, cursor.id);
      where.push(`(run_at > $${values.length - 1} OR (run_at = $${values.length - 1} AND id > $${values.length}))`);
    }
    const sql = `
      SELECT * FROM jobs
      WHERE ${where.join(" AND ")}
      ORDER BY run_at ASC, id ASC
      LIMIT ${Math.min(limit, 200) + 1}
    `;
    const res = await this.pool.query(sql, values);
    const rows = res.rows.map((r: any) => this.mapRow(r));
    const page = rows.slice(0, limit);
    const next = rows[limit];
    const nextCursor =
      next &&
      Buffer.from(JSON.stringify({ ts: next.runAt, id: next.id }))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    return { jobs: page, nextCursor: nextCursor ?? null };
  }

  async updateStatus(tenantId: string, jobId: string, patch: JobUpdatePatch): Promise<JobRecord | null> {
    const fields: string[] = [];
    const values: any[] = [];
    const now = normalizeDate();
    const append = (sql: string, val: any) => {
      values.push(val);
      fields.push(`${sql}=$${values.length}`);
    };
    if (patch.status) append("status", patch.status);
    if (patch.attempts !== undefined) append("attempts", patch.attempts);
    if (patch.maxAttempts !== undefined) append("max_attempts", patch.maxAttempts);
    if (patch.runAt) append("run_at", patch.runAt);
    if (patch.output !== undefined) append("output", JSON.stringify(patch.output));
    if (patch.error !== undefined) append("error", JSON.stringify(patch.error));
    if (patch.lockedAt !== undefined) append("locked_at", patch.lockedAt);
    if (patch.lockedBy !== undefined) append("locked_by", patch.lockedBy);
    if (patch.etag !== undefined) append("etag", patch.etag);
    if (patch.traceEventIds !== undefined) append("trace_event_ids", JSON.stringify(patch.traceEventIds));
    if (patch.domain !== undefined) append("domain", patch.domain);
    if (fields.length === 0) {
      return this.getJob(tenantId, jobId);
    }
    const terminalStatuses: JobStatus[] = ["succeeded", "failed", "dead_letter"];
    const guardTerminal = patch.status && terminalStatuses.includes(patch.status);
    values.push(now, tenantId, jobId);
    const sql = `
      UPDATE jobs SET ${fields.join(", ")}, updated_at=$${values.length - 2}
      WHERE tenant_id=$${values.length - 1} AND id=$${values.length}
      ${guardTerminal ? "AND status IN ('queued','running')" : ""}
      RETURNING *
    `;
    const res = await this.pool.query(sql, values);
    if (!res.rowCount) return null;
    return this.mapRow(res.rows[0]);
  }

  async acquireForRun(tenantId: string, jobId: string, workerId: string): Promise<JobRecord | null> {
    const now = normalizeDate();
    const res = await this.pool.query(
      `
      UPDATE jobs SET status='running', locked_at=$1, locked_by=$2, updated_at=$1
      WHERE tenant_id=$3 AND id=$4 AND status='queued' AND run_at <= $1
      RETURNING *
    `,
      [now, workerId, tenantId, jobId]
    );
    return res.rowCount ? this.mapRow(res.rows[0]) : null;
  }

  async findStaleRunning(tenantId: string, staleMs: number, limit = 20): Promise<JobRecord[]> {
    const threshold = new Date(Date.now() - staleMs).toISOString();
    const res = await this.pool.query(
      `
      SELECT * FROM jobs
      WHERE tenant_id=$1 AND status='running' AND locked_at IS NOT NULL AND locked_at < $2
      ORDER BY locked_at ASC
      LIMIT $3
    `,
      [tenantId, threshold, limit]
    );
    return res.rows.map((r: any) => this.mapRow(r));
  }

  async countByStatus(tenantId: string): Promise<Record<string, number>> {
    const res = await this.pool.query(`SELECT status, count(*)::int AS c FROM jobs WHERE tenant_id=$1 GROUP BY status`, [
      tenantId,
    ]);
    const counts: Record<string, number> = {};
    res.rows.forEach((r: any) => {
      counts[r.status] = Number(r.c);
    });
    return counts;
  }
}
