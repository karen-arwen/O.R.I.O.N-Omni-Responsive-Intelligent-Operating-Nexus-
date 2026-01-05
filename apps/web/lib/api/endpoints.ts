import { ApiError, apiFetch } from "./client";
import {
  snapshotSchema,
  timelineResponseSchema,
  trustResponseSchema,
  jobSchema,
  jobsResponseSchema,
} from "./schemas";
import { z } from "zod";

export type JobsQueryParams = {
  status?: string;
  decisionId?: string;
  correlationId?: string;
  domain?: string;
  type?: string;
  cursor?: string | number;
  limit?: number;
};

export const fetchHealth = async () => {
  const res = await apiFetch("/health");
  const json = await res.json();
  return z
    .object({
      status: z.string(),
      uptime: z.number(),
      version: z.string().optional(),
      timestamp: z.string(),
    })
    .parse(json);
};

export const fetchTimeline = async (params: Record<string, string | number | undefined>) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
  });
  const res = await apiFetch(`/timeline?${qs.toString()}`);
  const json = await res.json();
  return timelineResponseSchema.parse(json);
};

export const fetchTrust = async () => {
  const res = await apiFetch("/trust");
  const json = await res.json();
  return trustResponseSchema.parse(json);
};

export const fetchTrustDomain = async (domain: string) => {
  const res = await apiFetch(`/trust/${domain}`);
  const json = await res.json();
  return z
    .object({
      domain: z.string(),
      score: z.number(),
      fromDefault: z.boolean(),
      capabilities: z.object({ canExecute: z.boolean(), v: z.string() }),
    })
    .parse(json);
};

export const fetchSnapshot = async (decisionId: string, etag?: string) => {
  const res = await apiFetch(`/decisions/${decisionId}/snapshot`, {
    headers: etag ? { "If-None-Match": etag } : undefined,
  });
  if (res.status === 304) {
    return { fromCache: true, etag };
  }
  const json = await res.json();
  return { fromCache: false, ...snapshotSchema.parse(json) };
};

export const postFeedback = async ({
  decisionId,
  accepted,
  rejected,
}: {
  decisionId: string;
  accepted?: boolean;
  rejected?: boolean;
}) => {
  const res = await apiFetch(`/decisions/${decisionId}/feedback`, {
    method: "POST",
    body: JSON.stringify({ accepted, rejected }),
  });
  const json = await res.json();
  return z
    .object({
      decisionId: z.string(),
      domain: z.string(),
      trust: z.object({ oldScore: z.number(), newScore: z.number() }).optional(),
      feedback: z.enum(["accepted", "rejected"]),
      capabilities: z.object({ canExecute: z.boolean(), v: z.string() }),
    })
    .parse(json);
};

export const fetchJobs = async (params: JobsQueryParams) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
  });
  try {
    const res = await apiFetch(`/jobs?${qs.toString()}`);
    const json = await res.json();
    const parsed = jobsResponseSchema.parse(json);
    return parsed as (typeof parsed) & { unavailable?: boolean };
  } catch (err) {
    if (err instanceof ApiError && err.code === "jobs_unavailable") {
      return { jobs: [], nextCursor: null, unavailable: true } as { jobs: any[]; nextCursor: null; unavailable: boolean };
    }
    throw err;
  }
};

export const fetchJob = async (jobId: string) => {
  const res = await apiFetch(`/jobs/${jobId}`);
  const json = await res.json();
  return z.object({ job: jobSchema }).parse(json);
};

export const cancelJob = async (jobId: string) => {
  const res = await apiFetch(`/jobs/${jobId}/cancel`, { method: "POST" });
  const json = await res.json();
  return z.object({ status: z.string() }).parse(json);
};

export const retryJob = async (jobId: string) => {
  const res = await apiFetch(`/jobs/${jobId}/retry`, { method: "POST" });
  const json = await res.json();
  return z.object({ job: jobSchema }).parse(json);
};

export const executeDecision = async (decisionId: string) => {
  const res = await apiFetch(`/decisions/${decisionId}/execute`, { method: "POST" });
  const json = await res.json();
  return z
    .object({
      jobId: z.string(),
      status: z.string(),
      decisionId: z.string(),
      correlationId: z.string().optional(),
      capabilities: z.object({ canExecute: z.boolean(), v: z.string() }),
    })
    .parse(json);
};

export const approveDecision = async (decisionId: string, reason?: string) => {
  const res = await apiFetch(`/decisions/${decisionId}/approve`, { method: "POST", body: JSON.stringify({ reason }) });
  const json = await res.json();
  return z
    .object({
      decisionId: z.string(),
      jobId: z.string().optional(),
      status: z.string(),
      capabilities: z.object({ canExecute: z.boolean(), v: z.string() }),
    })
    .parse(json);
};

export const approveJob = async (jobId: string, reason?: string) => {
  const res = await apiFetch(`/jobs/${jobId}/approve`, { method: "POST", body: JSON.stringify({ reason }) });
  const json = await res.json();
  return z
    .object({
      jobId: z.string(),
      decisionId: z.string().optional(),
      status: z.string(),
      capabilities: z.object({ canExecute: z.boolean(), v: z.string() }).optional(),
      note: z.string().optional(),
    })
    .parse(json);
};
