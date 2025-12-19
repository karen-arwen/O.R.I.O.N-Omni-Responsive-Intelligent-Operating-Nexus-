export const queryKeys = {
  timeline: (params: Record<string, unknown>) => ["timeline", params],
  trust: ["trust"],
  trustDomain: (domain: string) => ["trust", domain],
  snapshot: (decisionId: string) => ["snapshot", decisionId],
  health: ["health"],
  jobs: (params: Record<string, unknown>) => ["jobs", params],
  job: (jobId: string) => ["job", jobId],
  jobsSummary: ["jobs", "summary"],
};
