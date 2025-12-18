CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  decision_id TEXT,
  correlation_id TEXT,
  domain TEXT,
  type TEXT,
  status TEXT,
  priority INT DEFAULT 0,
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 5,
  run_at TIMESTAMPTZ NOT NULL,
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL,
  idempotency_key TEXT NULL,
  input JSONB NOT NULL,
  output JSONB NULL,
  error JSONB NULL,
  trace_event_ids JSONB NULL,
  etag TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_run_at ON jobs (tenant_id, status, run_at);
CREATE INDEX IF NOT EXISTS idx_jobs_decision ON jobs (tenant_id, decision_id);
CREATE INDEX IF NOT EXISTS idx_jobs_correlation ON jobs (tenant_id, correlation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency ON jobs (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs (tenant_id, updated_at DESC);
