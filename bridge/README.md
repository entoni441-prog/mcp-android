# Antigravity Bridge — isolated MVP v0.1 (provisioned; agent not paired)

## Target
ChatGPT (existing Cloudflare connector) -> isolated D1 queue -> `agy-bridge-mvp` Worker -> Codespaces agent -> `agy -p` -> D1 response -> ChatGPT.

This first MVP deliberately avoids arbitrary commands, GitHub write operations, deployment or a new ChatGPT plugin.

## VERIFIED: 2026-10-31, Europe/Rome

1. Google Antigravity CLI 1.4.12 in existing experiment Codespace `haunted-shadow` successfully executed:
   `agy -p "Reply with exactly BRIDGE_OK. Do not use tools or modify files." --output-format json --sandbox --print-timeout 1m`
   Screenshot confirmed JSON fields `"status":"SUCCESS"` and `"response":"BRIDGE_OK\\n"` (the final newline is expected; the probe agent strips whitespace).
2. ChatGPT Cloudflare connector verified to have access to Workers and D1.
3. Created isolated **EU-jurisdiction D1 database** `agy-bridge-mvp`, UUID `3e60a1b1-c01c-4854-b0b3-5149faa4ffc0`, disabled replicas, initialized only `jobs` and `idx_jobs_queue`. SQL verification passed. Zero queued jobs at creation.
4. Uploaded **new independent Worker script** `agy-bridge-mvp` bound to this D1 as `DB` using compatibility date `2026-10-29`. Worker appeared in Cloudflare's script listing.
5. Checked Worker secrets: **no secrets configured**. As designed, agent claim and finish endpoints return HTTP 401 until `AGY_BRIDGE_AGENT_TOKEN` is configured.
6. No existing Worker, D1, production pipeline, `main`, Android code, quotas or billing settings were changed.

## Explicitly not yet done
- Agent pairing/authentication. **Never copy tokens, API keys, OAuth codes or credential files into GitHub, this conversation or logs.**
- Encrypted Worker secret `AGY_BRIDGE_AGENT_TOKEN` and matching secure Codespaces secret.
- Verifying the Worker's public URL, binding and health endpoint from a running Codespace.
- Running `bridge/agent.py --once` against the Worker, and end-to-end D1 job submission/result.
- Automatic agent execution after stop/start (Remote Control autostart is a separate verified mechanism).

## Security envelope and next step
The Worker currently uses a bearer token but it has NOT been provisioned, so job-polling endpoints are intentionally locked. Before any live agent call, design a secure pairing/secret distribution route that does not expose credentials in chat or Git. Prefer short-lived pairing with user-side approval and a persistent private credential stored only as a Codespaces secret and Cloudflare Worker secret. Keep first test strictly limited to fixed, harmless `probe` job kind. Do not enable arbitrary prompts, tools, files, or network-wide shell commands.

`--sandbox` is a defense-in-depth setting, not proof of absolute read-only isolation. The Worker must not enable anonymous execution or skip auth to simplify testing.

## Files
- `schema.sql`: isolated D1 schema.
- `worker.js`: authenticated fixed-probe job claim/result API.
- `agent.py`: codespace poller that runs a fixed, read-only probe.
- `README.md`: status and restrictions.

## Resumption
Continue from the last verified state. **Do not recreate the D1 database or Worker**, and do not repeat the Antigravity CLI check unless the installed CLI or environment changes. Existing remote-control Codespace and branch `experiment/agy-codespaces-autostart-20261030` remain independent.
