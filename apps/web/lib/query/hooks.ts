import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchHealth,
  fetchSnapshot,
  fetchTimeline,
  fetchTrust,
  fetchTrustDomain,
  postFeedback,
  fetchJobs,
  fetchJob,
  executeDecision,
  cancelJob,
  retryJob,
} from "../api/endpoints";
import type { JobsQueryParams } from "../api/endpoints";
import { queryKeys } from "./keys";
import { recordLatency } from "../telemetry/clientMetrics";
import { useCallback } from "react";

export const useTimeline = (params: Record<string, unknown>) => {
  return useInfiniteQuery({
    queryKey: queryKeys.timeline(params),
    queryFn: async ({ pageParam }) => {
      const start = performance.now();
      const data = await fetchTimeline({ ...params, cursor: pageParam });
      recordLatency("timeline", performance.now() - start);
      return data;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(params.correlationId || params.decisionId || params.domain || params.types || params.from || params.to),
    staleTime: 15_000,
  });
};

export const useTrust = () => useQuery({ queryKey: queryKeys.trust, queryFn: fetchTrust, staleTime: 30_000 });
export const useTrustDomain = (domain: string) =>
  useQuery({ queryKey: queryKeys.trustDomain(domain), queryFn: () => fetchTrustDomain(domain), staleTime: 30_000, enabled: !!domain });

export const useHealth = () =>
  useQuery({
    queryKey: queryKeys.health,
    queryFn: fetchHealth,
    refetchInterval: 15000,
    retry: 1,
  });

export const useSnapshot = (decisionId: string) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: queryKeys.snapshot(decisionId),
    queryFn: async ({ queryKey }) => {
      const prev = qc.getQueryData<{ etag?: string }>(queryKey);
      return fetchSnapshot(decisionId, prev?.etag);
    },
    staleTime: 60_000,
    enabled: !!decisionId,
  });
};

export const useFeedbackMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postFeedback,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.trust });
    },
  });
};

export const useApiHealth = () => {
  const qc = useQueryClient();
  const health = useHealth();
  const retryAll = useCallback(() => {
    qc.invalidateQueries();
    return health.refetch();
  }, [health, qc]);
  return { health, retryAll };
};

export const useJobs = (params: JobsQueryParams) => {
  return useInfiniteQuery({
    queryKey: queryKeys.jobs(params),
    queryFn: async ({ pageParam }) => {
      const start = performance.now();
      const data = await fetchJobs({ ...params, cursor: pageParam, limit: params.limit ?? 20 });
      recordLatency("jobs", performance.now() - start);
      return data;
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: 0,
  });
};

export const useJob = (jobId: string) =>
  useQuery({
    queryKey: queryKeys.job(jobId),
    queryFn: () => fetchJob(jobId),
    enabled: !!jobId,
    retry: 0,
  });

export const useExecuteDecision = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (decisionId: string) => executeDecision(decisionId),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: queryKeys.jobsSummary });
      qc.invalidateQueries({ queryKey: queryKeys.jobs({}) });
      qc.invalidateQueries({ queryKey: queryKeys.job(res.jobId) });
      qc.invalidateQueries({ queryKey: queryKeys.timeline({ decisionId: res.decisionId }) });
    },
  });
};

export const useCancelJob = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => cancelJob(jobId),
    onSuccess: (_data, jobId) => {
      qc.invalidateQueries({ queryKey: queryKeys.job(jobId) });
      qc.invalidateQueries({ queryKey: queryKeys.jobsSummary });
    },
  });
};

export const useRetryJob = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => retryJob(jobId),
    onSuccess: (_data, jobId) => {
      qc.invalidateQueries({ queryKey: queryKeys.job(jobId) });
      qc.invalidateQueries({ queryKey: queryKeys.jobsSummary });
    },
  });
};

export const useJobsSummary = () =>
  useQuery({
    queryKey: queryKeys.jobsSummary,
    queryFn: async () => {
      const res = await fetchJobs({ limit: 50 });
      const counts = res.jobs.reduce(
        (acc, job) => {
          acc[job.status] = (acc[job.status] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
      return { counts, unavailable: (res as any).unavailable };
    },
    staleTime: 10_000,
    retry: 0,
  });
