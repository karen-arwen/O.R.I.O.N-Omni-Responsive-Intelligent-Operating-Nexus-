import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchHealth, fetchSnapshot, fetchTimeline, fetchTrust, fetchTrustDomain, postFeedback } from "../api/endpoints";
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
