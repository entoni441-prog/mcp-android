# NEXUS / Codex Sentinel 0.4 — policy checkpoint and integration gate

Date: 2026-11-06 (Europe/Rome). Scope: isolated experimental branch only.
Base: e8fd8dd01cf8ad65dd6db92392ad3dcfebbdac86 (Guardian 0.3 REAL FULL PASS).

## Result and scope

A safe **read-only decision layer** for recovery of the Guardian itself has been implemented and tested.

- `sentinel-policy.mjs`: pure fail-closed eligibility function. No filesystem access, process discovery, spawn, termination, timers, services, subscriptions, permission changes or network I/O.
- `sentinel-policy.test.mjs`: 30 pure tests of confirmed completion and fail-closed recovery boundaries.
- `sentinel-policy-cli.mjs`: read a small local evidence JSON snapshot from an absolute, canonical path and return fixed-schema verdict only. No execution; `execution: "NOT_PERFORMED"`.
- `sentinel-policy-cli.test.mjs`: 3 read-only adapter tests, including malformed/unknown evidence and prompt/token redaction.
- `.github/workflows/nexus-codex-sentinel-policy-ci.yml`: isolated Windows + Ubuntu CI; also reruns existing Guardian 0.3 / Auto-Resume 0.2 regression tests.
- Changes are confined to the new experimental branch. No modification to `main`, NEXUS Host/Gateway, production configuration, Cloudflare, Windows security or power controls.

Important: **Sentinel is not yet a running independent process supervisor.** A request to write the active recovery-only process module was rejected by the execution environment's safety controls. It was not written or run, and there was no attempt to circumvent the block. No self-recovery of Guardian is claimed.

## Strict eligibility contract

Policy returns `STOP` by default, `COMPLETE` only for an independently verified matching completion marker, or `ELIGIBLE_FOR_SINGLE_RESUME` as a *non-executable advisory* verdict after all of the following are externally verified:

- Precisely scoped and approved task, confirmed owner STOP is **false**.
- Guardian exit **observed** and identity verified, not guessed from a missing heartbeat.
- Original Guardian, controller and CLI process IDs all confirmed absent; an unknown or possibly reused PID is an automatic STOP.
- Permanent task claims match the manifest taskId, and neither an earlier Guardian resume claim nor a Sentinel rescue claim exists.
- Git working tree clean; correct experimental branch; exact executable SHA-256 verified.
- Durable state is `RUNNING`, `attempt=0`, no terminal turn status, valid saved UUID of the exact CLI thread, and valid distinct saved controller/CLI PIDs.
- No matching completion marker, confirmed explicitly (unknown marker status is STOP).

This policy is not an authorization substitute: evidence must come from trusted, independently verified data, not untrusted model text or arbitrary process lists.

## Read-only NEXUS invocation

Existing NEXUS `run_command` can invoke Node.js without changing installed Host:

    node windows-pc-agent-lab/nexus-codex-autoresume/sentinel-policy-cli.mjs <ABSOLUTE-EVIDENCE-JSON-PATH>

The JSON output has only `decision`, `reason`, optional `attempt`, and `execution: "NOT_PERFORMED"`.

For local validation:

    node --test --test-concurrency=1 windows-pc-agent-lab/nexus-codex-autoresume/sentinel-policy.test.mjs windows-pc-agent-lab/nexus-codex-autoresume/sentinel-policy-cli.test.mjs

For full regression, use the isolated matrix workflow in this branch.

## Production gate / remaining work

1. Create a separately reviewed independent process watcher that observes the exact Guardian child handle, not just PID metadata. It must not create an OS service, scheduled task or autorestart on boot.
2. A recovery-only process must require a verified Guardian exit; match permanent claims; check no controller/CLI or unknown descendant is alive; create an exclusive durable one-use recovery fence **before** any resume; never remove old claims or re-run initial prompts.
3. A guardian crash while its controller/CLI remains running must be passive observation or STOP; no discovered PID may be force-killed. Fail closed if orphan identity is ambiguous.
4. Independent test scenarios: normal finish, real guardian-only SIGKILL, guardian crash with live controller, both exited, owner STOP, uncertain child identity, crashed recovery attempt, prior completion, wrong Git/hash, and no duplicated side effect.
5. Run Node tests on Windows and Ubuntu; independently verify one real Codex CLI test in a fresh Temp sandbox with immutable effect hash and a single exact-thread resume.
6. Only after explicit owner-approved task-scoped production design may registration into the installed NEXUS be considered. Do not merge to `main` or install a persistent watcher as part of this experimental checkpoint.

## Checkpoint distinction

- Auto-Resume 0.2: REAL PASS, Codex CLI child recovery.
- Guardian 0.3: REAL FULL PASS, controller-crash recovery and 30/30 tests, GitHub Actions 2/2.
- Sentinel 0.4: policy and NEXUS read-only evaluation implemented; **Guardian self-restart NOT IMPLEMENTED / NOT TESTED**.

This document is deliberately explicit so that the next session can continue from the exact checkpoint without repeating tests or guessing what is already implemented.

## Verification addendum — 06.11.2026

- On owner's Windows Node 24, all **33/33 Sentinel policy + read-only adapter tests PASS**, 0 failed (test-only isolated Temp data).
- GitHub Actions run 42165994834 (the original pure policy commit) succeeded on Windows and Ubuntu. A later run 42166116397 exposed a Windows runner temporary path alias issue in the adapter; run 42166226920 still failed on Windows after a case-normalization attempt. The final fix at `06e938f` inspects each path component for symbolic links rather than comparing canonical path spellings.
- The updated 33 tests PASS on the owner's Windows after this final fix. **The final GitHub Actions run for `06e938f` was not independently verified in this session**; do not label the final CI 2/2 PASS without checking its run and jobs.
- The independent process-recovery runtime is **NOT IMPLEMENTED**; neither automated Guardian restart nor real Guardian crash auto-recovery has been tested. Previous Guardian 0.3 REAL PASS remains valid and untouched.
- No production/main mutation. Experiment should remain isolated until approved implementation and fresh CI/real tests.
