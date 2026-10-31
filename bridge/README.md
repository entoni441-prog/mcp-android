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
