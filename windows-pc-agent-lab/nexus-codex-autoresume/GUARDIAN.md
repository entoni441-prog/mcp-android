# NEXUS / Codex CLI — Guardian 0.3 (experiment)

Date: 2026-11-06. Branch: experiment/nexus-codex-guardian-20261106.
Base: 2681d7776710f5eec11e28cb5efe364d16b23656 (Auto-Resume 0.2 real acceptance).

## What this does

- The existing controller 0.2 handles death of its own Codex CLI child.
- A separate guardian 0.3 starts that controller and observes its exit. On
  unexpected controller death it may resume the **recorded Codex CLI thread**,
  never the initial prompt and never a Desktop GUI thread.
- No NEXUS Host/Gateway installation, Windows service or scheduled task.
- Requires explicitly approved:true manifest, trusted local files, and a
  bounded task. Manifest approval is not cryptographic authentication.

## Fail-closed rules

1. Validate manifest, SHA-256 of exact CLI, Git branch/status, owner STOP.
2. Exclusive per-task guardian-claim.json before controller starts.
3. Record exact controller PID in guardian-process.json; observe controller
   close event, not just missing heartbeat.
4. Check matching bounded complete.json first. If valid, finish without any
   new Codex process.
5. Otherwise require unexpected death and saved status RUNNING, attempt 0,
   valid UUID thread ID, exact prior child PID, and no terminal turn status.
6. Confirm prior child PID is absent; if alive, reused, or unverifiable, STOP.
   Never signal a discovered PID.
7. Re-check stop, branch, hash, dirty tree and completion marker.
8. Create exclusive guardian-resume-claim.json BEFORE any resumed process.
9. Durably set attempt 1 / RECOVERING, then call only:
   codex exec resume --json <exact-thread-id> <bounded-resume-prompt>.
   No bypass flags; original Codex permissions and sandbox remain in place.
10. No second rescue of the same task. No Codex JSONL or stderr is persisted.
    A valid completion marker is required for COMPLETED; else STOP.

Guardian death itself is NOT auto-recovered: permanent claims prevent replay.
A live PID might be an orphan or reused OS PID, both STOP. The absence of the
original CLI PID does not prove every descendant has ended. No exactly-once
guarantee for external side effects: require app-specific idempotency keys.

## NEXUS integration boundary

This is an **opt-in command adapter**, not an installed service or production
integration. Existing NEXUS run_command can execute an explicitly approved
bounded task on the isolated branch. It must not be configured as a persistent
service or silently launched on unrelated sessions.

With Node 24 in the isolated repository:

    node windows-pc-agent-lab/nexus-codex-autoresume/guardian.mjs run <ABSOLUTE-MANIFEST-PATH>

Safe read-only fixed-schema status with no prompt, token or event log:

    node windows-pc-agent-lab/nexus-codex-autoresume/guardian-status.mjs <ABSOLUTE-STATE-DIRECTORY>

Status is purely observational. Claims and receipts are stored only under
the dedicated stateDirectory outside Git. Never delete claims to retry
uncertain work. NEXUS owner-stop and host-off signals are checked read-only.
NEXUS command/session cleanup is not a permanent restart service.

## Tests and current scope

    node --test windows-pc-agent-lab/nexus-codex-autoresume/controller.test.mjs windows-pc-agent-lab/nexus-codex-autoresume/pilot-worker.test.mjs windows-pc-agent-lab/nexus-codex-autoresume/guardian.test.mjs

Tests: normal completion; exclusive claim; real external SIGKILL of the
guardian-spawned Node controller followed by verified test CLI exit; exact
UUIDv7 session; one effect; independently live sentinel PID STOP without
killing it; owner STOP; dirty Git; hash mismatch; terminal controller STOP;
the 21 original Auto-Resume 0.2 tests.

New guardian tests use fake Codex, not the actual model. The independent
real-Codex CLI SIGKILL acceptance for controller 0.2 is documented in
NEXUS-CODEX-TASK-AUTORESUME-REAL-ACCEPTANCE-20261106.md.
A full controller SIGKILL real-Codex test in a fresh isolated OS-temp sandbox
is still required before production; the guardian remains EXPERIMENTAL.

## Production gate

Independently review Guardian and its fail-closed behavior; prove real Codex
controller crash with a test-only, idempotent effect; inspect descendants,
owner-stop semantics and completion postconditions; then design task-scoped
consent and controlled invocation in NEXUS. Do not merge/deploy/enable startup
or modify installed NEXUS without explicit owner authorization.
