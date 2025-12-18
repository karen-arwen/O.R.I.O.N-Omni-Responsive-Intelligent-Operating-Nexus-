import { useEffect } from "react";
import { useLiveToggle } from "./useLiveToggle";
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchTimeline } from "../api/endpoints";

export const useLiveTimeline = (params: Record<string, unknown>) => {
  const { live } = useLiveToggle();

  const query = useInfiniteQuery({
    queryKey: ["live-timeline", params],
    queryFn: async ({ pageParam }) => fetchTimeline({ ...params, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled:
      live &&
      Boolean(params.correlationId || params.decisionId || params.domain || params.types || params.from || params.to),
    refetchInterval: (data) => {
      if (!live) return false;
      return 2000;
    },
    refetchOnWindowFocus: live,
    staleTime: 2000,
  });

  useEffect(() => {
    if (!live) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") query.refetch();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [live, query]);

  return query;
};
