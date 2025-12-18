import { fetchTrust } from "../api/endpoints";

export type BundleInput = {
  decisionId?: string;
  correlationId?: string;
  filters: Record<string, unknown>;
  items: any[];
  snapshot?: any;
  trust?: Record<string, number>;
};

const hash = (str: string) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return Math.abs(h);
};

export const exportBundle = async (input: BundleInput) => {
  const trustData = input.trust ?? (await fetchTrust()).scoresByDomain;
  const payload = {
    version: "v1",
    exportedAt: new Date().toISOString(),
    decisionId: input.decisionId,
    correlationId: input.correlationId,
    filters: input.filters,
    items: input.items,
    snapshot: input.snapshot,
    trust: trustData,
  };
  const checksum = hash(JSON.stringify(payload));
  const data = { ...payload, checksum };
  const fileName = input.decisionId
    ? `orion-bundle-decision-${input.decisionId}.json`
    : input.correlationId
    ? `orion-bundle-corr-${input.correlationId}.json`
    : `orion-bundle-${Date.now()}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  const summary = `ORION bundle ${fileName} • items=${input.items.length} • filters=${Object.keys(input.filters).join(",")}`;
  return summary;
};
