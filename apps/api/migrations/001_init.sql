CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  type TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  decision_id TEXT,
  correlation_id TEXT,
  payload JSONB NOT NULL,
  meta JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_tenant_ts_id ON events (tenant_id, ts, id);
CREATE INDEX IF NOT EXISTS idx_events_decision ON events (tenant_id, decision_id, ts, id);
CREATE INDEX IF NOT EXISTS idx_events_correlation ON events (tenant_id, correlation_id, ts, id);
CREATE INDEX IF NOT EXISTS idx_events_aggregate ON events (tenant_id, aggregate_id, ts, id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (tenant_id, type, ts, id);
