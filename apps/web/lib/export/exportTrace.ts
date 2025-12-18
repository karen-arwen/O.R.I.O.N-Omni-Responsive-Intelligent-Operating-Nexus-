export const exportTrace = ({
  decisionId,
  correlationId,
  filters,
  items,
  snapshot,
}: {
  decisionId?: string;
  correlationId?: string;
  filters: Record<string, unknown>;
  items: any[];
  snapshot?: any;
}) => {
  const data = {
    metadata: {
      exportedAt: new Date().toISOString(),
      decisionId,
      correlationId,
      filters,
      appVersion: "v0",
    },
    items,
    snapshot,
  };
  const fileName = decisionId
    ? `orion-trace-decision-${decisionId}.json`
    : correlationId
    ? `orion-trace-corr-${correlationId}.json`
    : `orion-trace-${Date.now()}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};
