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

-- Secure device-pairing extension, 2026-10-31.
CREATE TABLE IF NOT EXISTS bridge_config (id INTEGER PRIMARY KEY CHECK(id=1), enroll_until INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO bridge_config(id,enroll_until) VALUES(1,0);
CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY,public_key TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','revoked')),created_at INTEGER NOT NULL DEFAULT (unixepoch()),approved_at INTEGER);
CREATE INDEX IF NOT EXISTS agents_status_idx ON agents(status,created_at);
CREATE TABLE IF NOT EXISTS nonces (agent_id TEXT NOT NULL,nonce TEXT NOT NULL,created_at INTEGER NOT NULL DEFAULT (unixepoch()),PRIMARY KEY(agent_id,nonce));
CREATE INDEX IF NOT EXISTS nonces_created_at ON nonces(created_at);
