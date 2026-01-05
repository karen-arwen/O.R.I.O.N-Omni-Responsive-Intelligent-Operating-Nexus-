import { z } from "zod";

export const timelineItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  timestamp: z.string(),
  decisionId: z.string().nullable().optional(),
  correlationId: z.string().nullable().optional(),
  domain: z.string(),
  kind: z.enum(["decision", "trust", "system", "audit", "other"]),
  summary: z.string(),
  payload: z.record(z.any()),
});

export const timelineResponseSchema = z.object({
  items: z.array(timelineItemSchema),
  nextCursor: z.string().nullable(),
  capabilities: z.object({ canExecute: z.boolean(), v: z.string() }),
});

export const trustResponseSchema = z.object({
  scoresByDomain: z.record(z.number()),
  defaultsByDomain: z.record(z.number()),
  deltas: z.object({
    accept: z.number(),
    reject: z.number(),
    implicitRepeatNoAction: z.number(),
  }),
  lastUpdatedByDomain: z.record(z.string()).optional(),
  capabilities: z.object({ canExecute: z.boolean(), v: z.string() }),
});

export const snapshotSchema = z.object({
  decisionId: z.string().optional(),
  correlationId: z.string().optional(),
  snapshot: z.record(z.any()),
  events: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      timestamp: z.string(),
    })
  ),
  capabilities: z.object({ canExecute: z.boolean(), v: z.string() }),
  etag: z.string().optional(),
});

export const jobSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  decisionId: z.string().nullable().optional(),
  correlationId: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  type: z.string(),
  status: z.enum(["queued", "running", "succeeded", "failed", "canceled", "dead_letter", "awaiting_approval"]),
  priority: z.number(),
  attempts: z.number(),
  maxAttempts: z.number(),
  runAt: z.string(),
  lockedAt: z.string().nullable().optional(),
  lockedBy: z.string().nullable().optional(),
  idempotencyKey: z.string().nullable().optional(),
  input: z.any(),
  output: z.any().optional(),
  error: z.any().nullable().optional(),
  traceEventIds: z.array(z.string()).nullable().optional(),
  etag: z.string().nullable().optional(),
});

export const jobsResponseSchema = z.object({
  jobs: z.array(jobSchema),
  nextCursor: z.string().nullable(),
});
