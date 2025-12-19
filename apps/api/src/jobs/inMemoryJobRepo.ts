import { randomUUID } from "crypto";
import { JobCreateInput, JobRecord, JobStatus, JobUpdatePatch, jobTypeToPermission } from "../../../../packages/shared/src/jobs";

const normalizeDate = (v?: string | Date) => (v ? new Date(v).toISOString() : new Date().toISOString());

export class InMemoryJobRepository {
  private jobs = new Map<string, JobRecord>();
  private idempotency = new Map<string, string>();

  async createJob(tenantId: string, input: JobCreateInput): Promise<{ job: JobRecord; created: boolean }> {
    const now = normalizeDate();
    const runAt = normalizeDate(input.runAt);
    const idempotencyKey = input.idempotencyKey ?? null;
    if (idempotencyKey) {
      const existingId = this.idempotency.get(`${tenantId}:${idempotencyKey}`);
      if (existingId) {
        const existing = this.jobs.get(existingId);
        if (existing) return { job: existing, created: false };
      }
    }
    const inferred = jobTypeToPermission(input.type);
    const domain = input.domain ?? inferred.domain ?? "generic";
    const job: JobRecord = {
      id: randomUUID(),
      tenantId,
      createdAt: now,
      updatedAt: now,
      decisionId: input.decisionId ?? null,
      correlationId: input.correlationId ?? input.decisionId ?? null,
      domain,
      type: input.type,
      status: (input.status as JobStatus | undefined) ?? "queued",
      priority: input.priority ?? 0,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
      runAt,
      lockedAt: null,
      lockedBy: null,
      idempotencyKey,
      input: input.input ?? {},
      output: null,
      error: null,
      traceEventIds: null,
      etag: null,
    };
    this.jobs.set(job.id, job);
    if (idempotencyKey) {
      this.idempotency.set(`${tenantId}:${idempotencyKey}`, job.id);
    }
    return { job, created: true };
  }

  async getJob(tenantId: string, jobId: string): Promise<JobRecord | null> {
    const job = this.jobs.get(jobId);
    return job && job.tenantId === tenantId ? job : null;
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
    const items = Array.from(this.jobs.values()).filter((j) => j.tenantId === tenantId);
    const filtered = items
      .filter((job) => {
        if (filters.status && job.status !== filters.status) return false;
        if (filters.decisionId && job.decisionId !== filters.decisionId) return false;
        if (filters.correlationId && job.correlationId !== filters.correlationId) return false;
        if (filters.domain && job.domain !== filters.domain) return false;
        if (filters.type && job.type !== filters.type) return false;
        return true;
      })
      .sort((a, b) => {
        const ta = new Date(a.runAt).getTime();
        const tb = new Date(b.runAt).getTime();
        if (ta === tb) return a.id.localeCompare(b.id);
        return ta - tb;
      })
      .filter((job) => {
        if (!cursor) return true;
        const ts = new Date(job.runAt).getTime();
        const cursorTs = new Date(cursor.runAt).getTime();
        if (ts > cursorTs) return true;
        if (ts === cursorTs && job.id > cursor.id) return true;
        return false;
      });
    const page = filtered.slice(0, limit);
    const next = filtered[limit];
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
    const existing = await this.getJob(tenantId, jobId);
    if (!existing) return null;
    const updated: JobRecord = {
      ...existing,
      ...patch,
      runAt: patch.runAt ?? existing.runAt,
      attempts: patch.attempts ?? existing.attempts,
      maxAttempts: patch.maxAttempts ?? existing.maxAttempts,
      output: patch.output ?? existing.output ?? null,
      error: patch.error ?? (patch.error === null ? null : existing.error),
      lockedAt: patch.lockedAt ?? existing.lockedAt ?? null,
      lockedBy: patch.lockedBy ?? existing.lockedBy ?? null,
      traceEventIds: patch.traceEventIds ?? existing.traceEventIds ?? null,
      domain: patch.domain ?? existing.domain,
      updatedAt: normalizeDate(),
    };
    this.jobs.set(jobId, updated);
    return updated;
  }

  async acquireForRun(tenantId: string, jobId: string, workerId: string): Promise<JobRecord | null> {
    const job = await this.getJob(tenantId, jobId);
    if (!job) return null;
    const nowIso = normalizeDate();
    if (job.status !== "queued" || new Date(job.runAt).getTime() > Date.now()) return null;
    const updated: JobRecord = {
      ...job,
      status: "running",
      lockedAt: nowIso,
      lockedBy: workerId,
      updatedAt: nowIso,
    };
    this.jobs.set(jobId, updated);
    return updated;
  }
}
