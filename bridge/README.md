# Antigravity Bridge — isolated MVP v0.2 (pairing pending)

## Verified at 2026-10-31
- Antigravity `agy -p` returned JSON `status: SUCCESS` and `response: BRIDGE_OK` from test Codespace; this confirms local headless CLI mode, not end-to-end connectivity.
- Isolated Cloudflare D1 `agy-bridge-mvp` in EU jurisdiction exists and has `jobs`, `agents`, `bridge_config` and `nonces` tables. Existing project databases untouched.
- Separate Cloudflare Worker `agy-bridge-mvp` uploaded successfully with D1 binding `DB`, and its workers.dev subdomain was explicitly enabled. Preview URLs disabled.
- Worker supports only fixed read-only probe jobs. No remote shell, arbitrary prompts, write operations or access to existing project deployments.
- Enrollment default closed: `SELECT enroll_until FROM bridge_config WHERE id=1` was 0; agent list empty. No user key or credential has been registered.
- Ed25519 signing: agent creates a 0600 private key in its own Codespace home; Cloudflare stores its public key. Request signatures include method, path, timestamp, random nonce and SHA-256(body). D1 prevents nonce reuse.
- Official docs: Cloudflare Workers WebCrypto implements Ed25519 SPKI import and signature verification. OpenSSL Ed25519 one-shot signature uses `pkeyutl -sign -rawin -in file`.
- Syntax: Worker upload passed Cloudflare validation; local Python/OpenSSL prototype signing verification passed. **Actual end-to-end signed auth is not yet tested**.

## Pairing protocol (explicit approval)
1. Operator opens a short enrollment window via this **isolated** D1 only:
   `UPDATE bridge_config SET enroll_until=unixepoch()+600 WHERE id=1`.
2. On the existing **test** Codespace `haunted-shadow`, load `bridge/agent.py` from the *experiment branch*, without checking out that branch into the working Codespace. Set `AGY_BRIDGE_URL=https://agy-bridge-mvp.entoni441.workers.dev`. Run agent with `--enroll`. Never place a private key, secret or OAuth code in the chat.
3. Agent prints only the public-key fingerprint. The owner supplies the fingerprint for independent verification; ChatGPT may inspect pending enrollment via authorized Cloudflare connector.
4. After matching fingerprint, approve exact agent ID in D1: `UPDATE agents SET status='approved', approved_at=unixepoch() WHERE id=? AND status='pending'`. Immediately close window: `UPDATE bridge_config SET enroll_until=0 WHERE id=1`.
5. Insert a single fixed `probe` job into isolated D1. From test Codespace run agent with `--once`, then check D1 result through Cloudflare connector.
6. Only after a successful signed end-to-end probe consider background polling and narrowly scoped task types.

## Security invariants
- Private key stays in Codespace `~/.config/agy-bridge/identity.pem` and is never committed, copied or pasted.
- Public key alone cannot execute jobs until owner approves it.
- Enrollment endpoint is time-limited and caps concurrent pending requests; approved endpoints require signed requests.
- No anonymous submission, no wildcard CORS; usage of `agy --sandbox` is defense-in-depth, not a guarantee of read-only enforcement.
- Do not touch `main`, original Codespace, other Workers, other D1 databases, billing limits or production.
- Worker currently has a public URL, but cannot execute a job without an approved agent. External health endpoint still needs live HTTP verification before claiming it works.

## Next verified checkpoint needed
- Confirm public `/health` responds from the **test Codespace** and exact URL resolves.
- Open 10-minute enrollment window only when user is ready.
- Verify matching public fingerprint and approve.
- Run fixed probe end-to-end.

## Pairing diagnosis — 2026-10-31 08:18 Europe/Rome
- Test Codespace GET `/health` returned `status: ready`.
- `urllib.request` enrollment with locally generated key failed HTTP 403, returning non-JSON body (`http_error`).
- Same Codespace's `curl` POST `/v1/agent/enroll` with deliberately invalid `{"public_key":"test"}` returned HTTP 400 and JSON `{"error":"invalid_key"}`. This proves direct curl reaches the correct Worker and active registration endpoint.
- D1 inspection confirmed 0 agents, registration window open; `403` likely from HTTP-client-specific protection, not the pairing logic, but root cause remains unproven.
- Modified `bridge/agent.py` to use `curl` transport with request body over stdin, not CLI arguments, preserving Ed25519 headers, JSON response parsing and sanitized errors. Commit `5667f167536a0c4481f9962cb18a3d13e4011191`. Still needs a live enroll test. No secret values sent in chat.
- Refreshed short registration window. Next action: fetch agent pinned to `5667f167...`, syntax-check it and rerun `--enroll` on test Codespace. Do not re-create DB, Worker or keys.


## Confirmed pairing & queued smoke test — 2026-10-31 (Europe/Rome)
- Test Codespace reached `/health` with response `{"service":"agy-bridge-mvp","version":"0.2","status":"ready"}`.
- Python urllib enrollment received HTTP 403 non-JSON. From same Codespace, direct `curl` to the same Worker endpoint returned HTTP 400 JSON `invalid_key` for a deliberate fake key.
- Agent HTTP transport switched to `curl` with request body on stdin, commit `5667f167536a0c4481f9962cb18a3d13e4011191`. Live enrollment then returned `Registration: pending`.
- Screenshot's public fingerprint `8fce8450fc2aa472` independently matched the sole pending agent in D1.
- Closed enrollment (`enroll_until=0`) then approved the exact matching pending agent via D1. Verified `status: approved`, exactly 1 change. No private key material or OAuth secrets disclosed.
- Created one fixed, harmless probe D1 job `probe-20261031-0820-bridge-v02`; initial status `queued`. Not yet executed.
- Next: On the already authorized test Codespace, use existing downloaded `/tmp/agy-bridge-agent.py` with `AGY_BRIDGE_URL=https://agy-bridge-mvp.entoni441.workers.dev python3 /tmp/agy-bridge-agent.py --once`, inspect signed claim and completion and separately confirm D1 job status/result.
- Do not issue additional jobs or approve another agent before observing first signed end-to-end result.


## CONFIRMED first signed end-to-end probe — 2026-10-31 08:24 Europe/Rome

- **Verified** one full request/result path: ChatGPT inserted fixed `probe` job in isolated Cloudflare D1 -> test Codespace agent `--once` claimed job with Ed25519 signature -> local Antigravity `agy -p` returned `BRIDGE_OK` -> agent posted signed result -> Worker updated D1 -> ChatGPT independently read result via Cloudflare connector.
- Screenshot terminal displayed `Probe: success accepted: True`. GitHub Codespace UI branch at time of test: `experiment/agy-codespaces-autostart-20261030` in test instance `haunted-shadow`.
- D1 query by exact id `probe-20261031-0820-bridge-v02` verified `status='success'`, `response='BRIDGE_OK'`, `error=''`. Agent identity matched the approved public-key fingerprint `8fce8450fc2aa472`.
- Confirmed registration closed (`bridge_config.enroll_until=0`) and only the explicitly approved agent present in D1.
- No secrets copied, no arbitrary commands executed, no code changed in working Codespace or `main`, and no existing Cloudflare production resources modified.
- **Scope limitation:** This proves **one-shot** execution initiated by a terminal command, not continuous hands-free polling, auto-start of the Bridge poller or ability to send arbitrary natural-language tasks. `Antigravity Remote Control` auto-resume is an already verified but separate subsystem.
- **Next safe milestone:** create a bounded, idempotent background polling service for the *existing* approved test agent, verify one more fixed probe without manual Codespaces terminal invocation, then test its stop/start recovery. Keep fixed-probe-only allowlist until separately authorizing scoped tasks; do not touch billing or idle timeout.

## Background polling v0.3 — code complete; activation pending

- New file: bridge/supervisor.py, initial commit 570a82a8dfa6dce348a59a919d0b0096047548b9. Detached single-process supervisor with file lock, PID/status files, graceful stop, exponential retry backoff, 30-second quiet polling, 130-second child timeout and environment allowlist.
- Auto-start is opt-in, limited to the existing experimental branch and the previously approved Ed25519 identity. The supervisor never enrolls itself and never changes Cloudflare or GitHub secrets.
- In experiment/agy-codespaces-autostart-20261030, the already-used .devcontainer/agy-remote.py now launches the supervisor only when its source exists, preserving prior Remote Control behavior. devcontainer.json is unchanged to avoid rebuild and losing credentials.
- Local integration test in a disposable filesystem and process namespace passed: startup, second start idempotence, repeated simulated probe polling and stop. No live background process was launched in the user's Codespace by the GitHub connector.
- Next verification: operator synchronizes existing test Codespace, downloads pinned supervisor to its persistent workspace, starts launcher once; after that ChatGPT queues a single harmless probe, verifies D1 success without the operator invoking the agent, then checks supervisor recovery after an ordinary Codespace stop/start. Do not queue probes until the supervisor is confirmed running.
- This does not make GitHub Codespaces always-on or wake it when stopped. Default idle timeout and billing limits remain in force.
