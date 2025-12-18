type Metric = {
  name: string;
  value: number;
  count: number;
};

const metrics: Record<string, Metric> = {};

export const recordLatency = (name: string, ms: number) => {
  const m = metrics[name] ?? { name, value: 0, count: 0 };
  m.value = m.value + (ms - m.value) / (m.count + 1);
  m.count += 1;
  metrics[name] = m;
};

export const getMetrics = () => metrics;

export const clearMetrics = () => {
  Object.keys(metrics).forEach((k) => delete metrics[k]);
};
