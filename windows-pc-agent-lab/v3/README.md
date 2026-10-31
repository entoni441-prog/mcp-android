# Windows PC Agent v3 — managed control core, experimental ONLY

**Status:** source + offline tests; NOT deployed, NOT installed, and NOT yet controlling the user's PC. Developed separately from the verified v2 read-only heartbeat. Do not merge into `main` or modify production.

## What is implemented

- Existing v2 device identity, decrypted locally via Windows DPAPI CurrentUser (no re-enrollment).
- Outbound HTTPS polling using signed ECDSA P-256 requests. No listening ports, no SSH, no remote shell, no tokens copied to Windows.
- Privileged Cloudflare D1 queue: create tasks only through authenticated Cloudflare API, not public Worker routes. Device is able to receive jobs only with an active time-limited v3 grant.
- Six fixed operations: `get_status`, `list_dir`, `read_text`, `write_text` (requires file SHA-256 when replacing), `make_dir`, `open_app` (Notepad or Calculator). File operations strictly limited to `%LOCALAPPDATA%\PcAgentReadonlyLab\workspace`; no deletes, no arbitrary command interpreter, no other file trees. Symlinks and relative path traversal forbidden.
- Job lease (120s), one acknowledgement per job, signature and nonce replay defense, server-side audit events, reject revoked/expired access. No automatic job retries or re-execution after timeout.
- One visible Windows process with `run --minutes=15` (1–60 min). Stop with Ctrl+C. No service, scheduled task, autostart, screen capture, or unrestricted app automation. Those are separate unimplemented milestones.

## Server setup (DO NOT execute until staged rollout approval)

1. Keep working v1+v2 Worker unchanged. Build a combined v1+v2+v3 module with `node windows-pc-agent-lab/v3/build-worker.mjs`, then verify all CI tests. Prefer separate isolated v3 Worker or explicitly approved guarded rollout with preserved v2 rollback.
2. Apply `schema-v3.sql` ONLY to test D1 database `pc-agent-readonly-lab` (UUID `8c972046-2add-4df7-9f16-a8172b8061e2`). No migration touches existing v1/v2 tables.
3. Create a **short-lived, explicit v3 grant** in `v3_grants` for exact confirmed v2 device ID; do not grant other devices or open v2 pairing. Sample scoped query (replace placeholder only after verifying identity):
   `INSERT INTO v3_grants(device_id,state,expires_at) VALUES(?,'active',unixepoch()+1800) ON CONFLICT(device_id) DO UPDATE SET state='active',expires_at=excluded.expires_at;`
4. Admin-only enqueue after validating allowed action and arguments: `INSERT INTO v3_jobs(id,device_id,action,args_json,state,created_at,expires_at) VALUES(?,?,?,?,'queued',unixepoch(),unixepoch()+300);`. Use a unique 32-hex ID. No public enqueue route. Results available in D1 `v3_jobs`, audit in `v3_events`.
5. Emergency revocation: `UPDATE v3_grants SET state='revoked' WHERE device_id=?;` and `UPDATE v3_jobs SET state='cancelled' WHERE device_id=? AND state='queued';`. An already leased operation might finish before next poll; the local user can always Ctrl+C immediately.
6. After validated rollout and explicit local agreement, download code pinned to immutable GitHub SHA and use `node windows-agent-v3.mjs run --minutes=15` **in its folder alongside `identity-v3.mjs` and `actions.mjs`**. It does not install a background service. Device key already lives in the original v2 identity file.

## Security limitations and next milestone

- Files and results from the dedicated workspace are stored as JSON **in plaintext inside the test D1**, protected by Cloudflare account authorization. Do not put passwords, tokens, or sensitive personal documents in it. There is currently no application-layer end-to-end encryption of job data.
- Cloudflare admin compromise can enqueue any of the six defined operations; Windows local-user compromise can access the DPAPI key. This is NOT secure against a compromised PC or Cloudflare account.
- Tasks claimed but not acknowledged before the lease expires are left `leased` for manual diagnosis; no silent retries for state-changing operations.
- A 15-second polling interval is foreground-only and consumes Cloudflare requests. Do not enable 24/7 use before reviewing quotas, costs, notifications, pause/revoke UX and Windows service lifecycle.
- **Not implemented:** full desktop/GUI control, screen sharing, arbitrary program execution, unrestricted filesystem, unattended service or UI confirmation; requires separate design and testing. A secure complete controller must explicitly address those before claiming "full access".
