-- Apply ONLY to the isolated pc-agent-readonly-lab D1 after CI/review.
-- Do not run against Chat Router, CONSILIUM, TRINITY or production D1.
CREATE TABLE IF NOT EXISTS v2_enrollment_gate (
  name TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS v2_devices (
  id TEXT PRIMARY KEY,
  public_jwk TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  last_seq INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER,
  last_metrics_json TEXT
);
INSERT OR IGNORE INTO v2_enrollment_gate(name,expires_at) VALUES('windows-v2',0);
