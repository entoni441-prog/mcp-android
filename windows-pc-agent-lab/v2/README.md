# Windows PC Agent v2 — read-only telemetry prototype (NOT DEPLOYED)

Status: offline implementation only, preserved on the dedicated experimental branch. Do not merge into `main` or deploy without reviewing CI and explicit runtime consent. The verified v1 diagnostic remains untouched.

## Boundaries

- Only two client actions: `enroll` and `run` (bounded 1–60 min). There is **no** resident service, auto-start, Windows scheduled task, network listener, remote shell, file scanning, file transfer, screenshot, browser access, or job queue.
- Live telemetry contains only Windows uptime, total/free RAM, and Node.js version. No passwords, personal files, usernames, process list, browser history, network inventory or Cloudflare/GitHub tokens.
- Every request uses HTTPS to the **fixed** URL `https://pc-agent-readonly-lab.entoni441.workers.dev`; TLS verification stays enabled.
- Device creates a distinct ECDSA P-256 key; private key stored under `%LOCALAPPDATA%\PcAgentReadonlyLab\identity-v2.json` **encrypted with Windows DPAPI CurrentUser**. The private key is never sent to Cloudflare. Cloudflare stores only the public key, fingerprint and latest metrics.
- Enrollment requires a short-lived gate opened through privileged Cloudflare D1 (not public HTTP). Approval must match a deliberate user request and the console fingerprint. The gate must be closed immediately afterward.
- Every status/heartbeat request is signed over protocol version, HTTP method, exact route, and request JSON. Heartbeats use a strictly increasing sequence number with a single atomic D1 update. Revocation takes effect on the next request.
- Cloudflare public HTTP has NO report-read, approval, command, arbitrary URL, desktop, or admin endpoints. Reading status for administrators or revoking a device requires privileged Cloudflare D1 API; no API secrets in repo or agent.

## Artifacts

- `worker-v2.mjs`: **standalone** v2 server source; not a drop-in replacement for the currently deployed v1 worker.
- `windows-agent-v2.mjs`: Windows Node.js 24 foreground client. Source is not automatically executed.
- `schema-v2.sql`: isolated D1 schema migration, **applied 2026-10-31** directly to test-only D1 `pc-agent-readonly-lab`; CI itself never applies migrations. Gate `windows-v2` remains closed.
- `tests/worker-v2.test.mjs`: mock-D1 security/protocol tests; no cloud calls and no changes to Windows.

## Offline verification

`node --check` each JavaScript file, then `node --test tests/worker-v2.test.mjs` from this folder. GitHub Actions runs those checks using Node.js 24.

## Deployment gates — not automatic

1. Review code, Windows DPAPI implementation and test results, then approve use of the existing **test-only** Worker. v1 routes must stay available during migration; either route by prefix or deploy v2 into a separate test Worker. Never replace live v1 script with standalone v2 source without an integration plan.
2. **Completed 2026-10-31:** `schema-v2.sql` was applied ONLY to D1 `pc-agent-readonly-lab` (`8c972046-2add-4df7-9f16-a8172b8061e2`); v2 gate is CLOSED and 0 devices are enrolled. Do not rerun migration. Next test v2 protocol in a separate test Worker or safely integrated v1+v2 staging worker.
3. Before local enrollment, obtain the user's explicit consent to download/run the reviewed script; download by immutable commit SHA and check syntax. Manually open v2 gate via privileged D1 shortly before user runs `node windows-agent-v2.mjs enroll`.
4. Compare the user-displayed fingerprint with the **specific** pending D1 record, approve it explicitly, then close v2 gate. Pairing alone sends no telemetry.
5. After user permission, start `node windows-agent-v2.mjs run --minutes=5` in PowerShell. Inspect only most recent metrics via privileged D1; verify revocation and Ctrl+C shutdown. Do not install it as a service without a separate design and authorization.

## Scoped administrative D1 commands (examples; never execute in wrong DB)

Open enrollment gate briefly (only with user starting device enrollment immediately):

```sql
UPDATE v2_enrollment_gate SET expires_at=unixepoch()+900 WHERE name='windows-v2';
```

Confirm pending fingerprint:

```sql
SELECT id,fingerprint,status,created_at FROM v2_devices WHERE status='pending' ORDER BY created_at DESC LIMIT 5;
```

Approve exact fingerprint **after explicit device verification**:

```sql
UPDATE v2_devices SET status='approved', approved_at=unixepoch()
 WHERE id=? AND fingerprint=? AND status='pending' AND created_at>unixepoch()-900;
```

Close gate (regardless of success):

```sql
UPDATE v2_enrollment_gate SET expires_at=0 WHERE name='windows-v2';
```

Get latest metrics after a successful signed heartbeat:

```sql
SELECT fingerprint,status,last_seen_at,last_seq,last_metrics_json FROM v2_devices WHERE id=?;
```

Revoke:

```sql
UPDATE v2_devices SET status='rejected' WHERE id=?;
```

## Explicit limitations

- This is an **offline prototype** until deployed and checked against actual D1 + an opt-in Windows session. Local unit tests do not establish a real Windows DPAPI round-trip or live endpoint compatibility.
- A Windows admin, malware running as the same user, or a compromised Cloudflare account can access or revoke device state; this is not a defense against a compromised PC.
- No unattended 24/7 monitoring is enabled. To add service/auto-start, remote jobs, screen viewing or filesystem features would require separate threat modeling, an authorization model and explicit user consent.
