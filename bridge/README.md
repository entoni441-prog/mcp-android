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
