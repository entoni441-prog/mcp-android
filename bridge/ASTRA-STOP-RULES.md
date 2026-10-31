# ASTRA / Work — Stop Rules and Cost-Control Protocol
Status: experimental project operating rule, recorded 2026-10-31

## Purpose
Avoid consuming Work/Claude/agent credits through repeated identical investigations, authentication loops or stalled browser operations. Apply these rules to every task dispatched by ChatGPT in the Antigravity GUI and Bridge projects. They do not grant new tool permissions.

## Hard limits
1. Inspect the latest confirmed checkpoint before beginning; do not redo completed steps.
2. For each blocked operation perform at most **one normal attempt plus one targeted diagnostic**. Retry the operation only if the diagnostic identifies a concrete changed prerequisite and the change is verified. Never use repeated refresh/reopen/authentication cycles without new evidence.
3. When a tool call times out, returns 401/403, requests a password, 2FA, passkey, device code, account approval, or a permission the agent lacks, **stop the affected workflow immediately**. Never invent credentials, request secret values in chat, or route around a tool's safety block.
4. If an instance is Offline, check its status **once** and try a single non-mutating refresh. If no online, identifiable test instance is accessible, stop GUI exploration. Do not touch other instances or ask for repeated GitHub login.
5. Set bounded tool-call timeouts and cap investigation to **two meaningful observations per blocker**. If evidence remains unchanged, stop instead of looping. No arbitrary background work.
6. Continue unrelated safe substeps only when they produce distinct, verifiable value; otherwise stop the task.

## Required blocker report (short)
- **Completed:** last independently verified checkpoint / artifact.
- **Blocked at:** exact screen, command, error, timestamp if known.
- **Cause:** confirmed cause versus hypothesis (label clearly).
- **Need from user:** precisely one minimal action, or "no action; cannot proceed with available access".
- **Safe state:** what was not changed (main, production, working Codespace, security, billing); any reversible change and recovery status.
- **Resumption:** exact next action after blocker is removed.
- **Usage control:** attempts made and why further repeats are pointless.

## Current example
Antigravity Remote Control showed six Offline instances after a verified Refresh. Work's GitHub Cloud Browser sign-in stopped at a device-verification step and secure-form timeout; GitHub repo connector did not offer Codespace start/status. The user later opened test Codespace `haunted-shadow` on their own Samsung. Next: inspect the already authenticated Antigravity remote list once, correlate only the verified online test instance if available, or stop with this report. Never repeat GitHub authentication loops.

## Nonnegotiable restrictions
Do not change `main`, production, working Codespaces, security controls, permission presets, credentials, billing, or idle limits. Respect safety/system tool blocks. Update technical checkpoint only with observed results and cite commit SHA. Do not claim success from actions merely planned.

This policy is a task instruction; include or reference it in each future Astra Work prompt because repository files are not guaranteed to be read automatically.
