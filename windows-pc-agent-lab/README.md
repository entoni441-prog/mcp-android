# Windows PC Agent — isolated read-only lab

Created 2026-10-31; non-production, separate from Chat Router, CONSILIUM, TRINITY and Antigravity.

## Verified scope

- Windows 11 machine: Ryzen 7 3800X, ~64 GiB RAM, ~370.7 GiB free disk, firmware virtualization off (confirmed by prior read-only diagnostics).
- Node.js v24.21.0 works. `python.exe` from WindowsApps was only an App Execution Alias. Git and cloudflared not installed, none required.
- Test Worker: `https://pc-agent-readonly-lab.entoni441.workers.dev`.
- Isolated D1 database: `pc-agent-readonly-lab`, region jurisdiction `eu`, id `8c972046-2add-4df7-9f16-a8172b8061e2`.
- CI: GitHub Actions workflows `.github/workflows/windows-pc-agent-lab.yml`.
- Developer source on experimental branch `experiment/windows-pc-agent-readonly-20261031`. **Never merge without explicit approval.**

## Security boundary

- First phase only: one **fixed, signed Windows hardware/capabilities report** after administrator approval.
- Agent uses outbound HTTPS and Node + built-in read-only WMI cmdlets. No inbound ports, SSH host service, installs, admin elevation, arbitrary remote commands, screenshots or filesystem scans.
- No GitHub/Cloudflare tokens, passwords or credentials placed into agent, repo or command.
- Browser/Live View, persistent Windows agent and long-running computer control are NOT implemented by this proof of concept.
- The D1 database is not directly public. Public Worker supports only GET /health, POST /v1/enroll, GET /v1/status and POST /v1/report. No public report read or approval API. The Cloudflare authenticated administration tool performs all gate opening, device approval, report reading and revocation.
- Up to 5 pending devices during a manually opened gate; registration key is ephemeral ECDSA P-256. Device prints short public fingerprint for human approval. Do not approve a device without correlating with a user's intentionally started enrollment and matching fingerprint.
- Auto-reject/expire at 15 minutes for pending; signed report accepted for 1 hour after approval. One report per enrollment, no replay. The user can stop the agent with Ctrl+C before approval.

## Privileged Cloudflare D1 actions (never expose API secrets)

Initialize schema:
```sql
CREATE TABLE IF NOT EXISTS enrollment_gate(name TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, public_jwk TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')), created_at INTEGER NOT NULL, approved_at INTEGER);
CREATE TABLE IF NOT EXISTS reports(device_id TEXT PRIMARY KEY REFERENCES devices(id), received_at INTEGER NOT NULL, report_json TEXT NOT NULL);
INSERT OR IGNORE INTO enrollment_gate(name,expires_at) VALUES('windows-v1',0);
```

Open 15-minute gate just before running agent:
```sql
UPDATE enrollment_gate SET expires_at=unixepoch()+900 WHERE name='windows-v1';
```

Find pending device(s) and fingerprints **after** local launch:
```sql
SELECT id, fingerprint, status, created_at FROM devices WHERE status='pending' ORDER BY created_at DESC LIMIT 5;
```

Approve only the verified physical enrollment, no approval before user confirms device:
```sql
UPDATE devices SET status='approved',approved_at=unixepoch()
 WHERE id=? AND fingerprint=? AND status='pending' AND created_at > unixepoch()-900;
```

Read signed report after device posts it:
```sql
SELECT d.fingerprint,r.received_at,r.report_json FROM reports r JOIN devices d ON d.id=r.device_id ORDER BY r.received_at DESC LIMIT 1;
```

Close gate early:
```sql
UPDATE enrollment_gate SET expires_at=0 WHERE name='windows-v1';
```

Revoke:
```sql
UPDATE devices SET status='rejected' WHERE id=?;
```

Do not blindly execute example queries with placeholders. Every query is restricted to this isolated EU D1 database, never any production database.

## User execution

Download the `windows-agent.mjs` at an **immutable full commit SHA** over HTTPS with PowerShell. Syntax-check with `node --check` before `node` executes. Supply only the public `PC_AGENT_ENDPOINT` environment variable. Source executes on the local machine only when user starts it; never automatically installs a resident service. Device key is ephemeral and not persisted. It waits up to 12 minutes for approval then sends one sanitized report and exits.

Server can be smoke-tested at GET `/health`, returning `{"status":"ready","component":"pc-agent-readonly-lab","execution":"forbidden"}`; verified externally. Cloudflare D1 binding and workers.dev were checked after deployment.

## Boundary for next phase

This is diagnostic *delivery*, not ongoing remote access. Add user-owned secure persistent identity, periodic read-only metrics, authenticated job queue with a fixed allowlist, cancellation and Live View separately after explicit approvals, code review and anti-abuse protections. Do not ever silently enable remote shell or public desktop access.
