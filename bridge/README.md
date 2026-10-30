# Antigravity Bridge — isolated MVP v0.1 (not deployed)

## Goal
ChatGPT -> existing Cloudflare connector -> **new isolated D1 queue** -> private Worker agent endpoint -> Codespaces CLI `agy -p` -> result in D1 -> ChatGPT.

No new ChatGPT plugin is needed for the first smoke test because ChatGPT already has authorized Cloudflare D1 access. This is an engineering shortcut; a dedicated OAuth MCP connector can be added only after the transport is proven.

## Confirmed prerequisites
- GitHub experimental Codespace successfully starts Antigravity Remote Control after stop/start, once CLI + OAuth are configured.
- Official Antigravity CLI supports `agy -p`, `--output-format json`, `--sandbox`; **a live headless invocation in the Codespace is not yet verified**.
- Cloudflare connector has read/write API access. Existing Workers and D1 databases are **not** used by this prototype.

## Security envelope
- Worker requires bearer token for all agent endpoints. Secret must be stored as a Cloudflare Worker secret and a separate Codespaces secret, never in GitHub code, chat text, or logs.
- Worker has only an isolated D1 binding, and accepts only a fixed `probe` job type.
- Agent never executes a caller-supplied command/prompt: hardcoded harmless `BRIDGE_OK` test only.
- The agent strips bridge secret environment variables before starting `agy`.
- No wildcard CORS, no anonymous job submission, no GitHub token exposure, no modifications to main/production.
- `--sandbox` is defense-in-depth, *not* a proof of read-only sandbox security. Do not enable arbitrary prompts or tasks until a stricter execution policy is established.

## Deployment prerequisites (NOT YET PERFORMED)
1. Verify `agy -p` manually in the already-authorized test Codespace.
2. Create **new** D1 database (`agy-bridge-mvp`), run `bridge/schema.sql`.
3. Create **new** Cloudflare Worker (`agy-bridge-mvp`) bound to the new D1 as `DB`; set `AGY_BRIDGE_AGENT_TOKEN` as encrypted Worker secret.
4. Configure matching `AGY_BRIDGE_URL` and `AGY_BRIDGE_AGENT_TOKEN` in the test Codespace's secure secrets (not source).
5. Submit one `probe` job using ChatGPT's existing Cloudflare connector (D1 insert); run `python3 bridge/agent.py --once` on test Codespace; read the D1 result via connector.

**Stop if any prerequisite cannot be verified.** Do not expose the endpoint without authentication. Do not touch production or change any existing payment guardrails.

## Future scope (after live MVP)
Approve job kinds and scopes per workspace; authenticated MCP tool integration; acknowledgments and audit; bounded concurrency; explicit consent for write/deploy; Codespace start API with limited rights; monitor free quota and auto-stop.
