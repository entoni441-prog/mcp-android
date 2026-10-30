-- Isolated D1 database for Antigravity Bridge; never apply to existing project databases.
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind = 'probe'),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','success','error')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  claimed_at INTEGER,
  lease_until INTEGER,
  agent_id TEXT,
  response TEXT,
  error TEXT,
  usage_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(status, created_at);
