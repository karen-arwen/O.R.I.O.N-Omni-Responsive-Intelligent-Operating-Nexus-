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
