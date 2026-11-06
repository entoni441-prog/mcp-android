# NEXUS Guardian — Windows Scheduler architecture, safe experimental checkpoint

Date: 2026-11-06. Branch: `experiment/nexus-guardian-scheduler-20261106`.
Base: `aa6d53120e3ac02d1cb53f715dbbc39e3d021526`.
Production/main/installed NEXUS Host/Gateway unchanged. No OS task, service, security setting, startup or dependency installed.

## Accepted architecture

Claude review: no blocking architecture objection conditional on OS-owned singleton, Job Object process containment, durable operation journal, epoch fencing, reboot policy and bounded persistent restart budget.

**No independent Sentinel process.** The earlier Sentinel 0.4 pure decision policy is retained as reference, not a daemon.

Windows Task Scheduler is the outer **process restart authority**, with one *new, separate* Guardian task that is disabled by default. It must not replace or modify `NEXUS-Host-Logon` or `NEXUS-Host-Run`. The installed NEXUS 0.6.1 uses both existing tasks. Draft template: `EXPERIMENTAL-GUARDIAN-SCHEDULER-DISABLED.xml`.

The experimental task is triggered at **owner logon** (GUI session exists), has `MultipleInstancesPolicy=IgnoreNew`, and at most five scheduler restarts 1 minute apart. `Enabled=false` until explicitly approved and fully tested. A task that intentionally returns STOP must exit successfully with a STOP receipt (to prevent useless Scheduler failure restarts). Unexpected crash returns nonzero.

## Strict preconditions not yet implemented

**OS singleton**: hold a named Windows mutex or a genuine exclusive open file handle for the entire process lifetime. PID and start-time are diagnostics, not ownership. Scheduler IgnoreNew is extra protection, not the sole lock.

**Containment**: use a native Windows Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, and do not permit breakaways. A proper runner must create the first worker suspended, assign it to the Job Object *before it executes*, then resume it. If assignment fails -> STOP, never launch outside containment. On observed hang, close/terminate the owned Job and verify it contains zero active processes before replacement. Do not rely on `taskkill /t` or orphan PID lists. The old installed NEXUS supervisor intentionally uses a separate launcher; do not transplant that mechanism into this Guardian.

**Heartbeat**: a stale heartbeat is suspicion, not proof of death. When Guardian or controller is still alive, do NOT create a replacement instance. A controller may be hung and need controlled Job termination; until confirmed no live old process or external uncertainty remains, fail closed.

**Epoch**: only the active OS-mutex owner can allocate a higher durable generation. Every operation/receipt is tagged with its originating generation. Reject old-epoch receipts for new work; this fences journal readers, but cannot prevent a zombie from performing external side effects unless the external provider also validates a fencing token or idempotency key.

**Restart budget**: persist counts and timestamps durably, at most five restarts in a bounded time window; reset only after 30 minutes of verified stable operation. At exhaustion -> STOP and notify owner using an already approved channel (no notification integration has yet been authorized or implemented).

**Reboot**: GUI jobs start only on owner logon; Codex CLI thread restoration across Windows reboot must pass an independent real acceptance. On reboot any irreversible IN_FLIGHT is STOP/RECONCILIATION_REQUIRED.

## Operation journal implemented (test-only library)

`operation-journal.mjs` provides:
- `PREPARED` durable create-only entry before the external action is ever armed.
- `IN_FLIGHT` durable create-only entry before the external call starts.
- `COMMITTED` immutable receipt only after caller asserts a verified external identifier.
- Exclusive publication uses a locally fsynced temp file + same-directory hard link (never overwrites a prior receipt); OS directory fsync is best-effort.
- Unique taskId, operationId and epoch in every record. Old-epoch receipts are ignored for a new operation.
- Recovery of IN_FLIGHT always yields STOP / RECONCILIATION_REQUIRED. No automatic retry even when an idempotency key is present without verified provider postconditions.

Limit: this is a **journal library**, not an enforced network/GUI transaction layer. The caller must reliably record IN_FLIGHT before side effects and independently verify external receipts. A caller-supplied `verified:true` is not cryptographic evidence. The key distinction: at-most-one automatic attempt *under the protocol*, not exactly-once external delivery. Loss of an acknowledgement after an external effect always creates an uncertain outcome.

`restart-gates.mjs` is a pure defensive eligibility contract. It never launches or kills processes. Its OS evidence input must come from trusted handles, not a model-supplied JSON guess.

## Tests and unverified scope

On the owner's real Windows Node 24: 47/47 tests PASS in the first revision (39 restart guards and 8 append-only journal tests). The reboot and durable restart budget gates were tightened afterward; the updated matrix still requires CI verification.

The 0.2 CLI child SIGKILL and 0.3 Guardian controller SIGKILL remain independently REAL PASS in previous checkpoints; do not repeat those tests solely because of this new architecture.

**NOT YET COMPLETE**: native Windows mutex and suspended-process Job Object launcher, actual Scheduler task creation, persistent restart counter implementation, epoch-locked writer, external idempotency adapter, real hung-but-alive process acceptance, Windows reboot session-resume acceptance. Do not claim automatic self-recovery is operational.

## Acceptance required before installation

1. Native helper starts its OWN sandbox child in a Job Object without breakaways and retains a kernel singleton for the task; verify second launch is rejected.
2. Real hang test: controller alive but no heartbeat, Job terminated with zero active associated processes, fenced epoch transition, no duplicate test effect.
3. Crash after external effect but before COMMITTED: IN_FLIGHT stays STOP, never automatically repeated; test unknown result and provider idempotency separately.
4. Crash-loop test: on-disk budget remains after Guardian process death and owner logon, eventually STOP, owner notification tested.
5. GUI logon + actual reboot trial with Codex exact saved CLI thread; no assumptions from earlier SIGKILL-only tests.
6. Independent Windows/Ubuntu tests for the pure contract; live Windows Job tests only on owner's isolated Windows. Review permissions before enabling the DISABLED Task Scheduler template.
7. No change to main/production without a separate explicit approval.

The next implementation is the **native Windows process containment and singleton helper**. It should be completed with the existing tooling if technically possible, without installing an unnecessary SDK/subscription or attempting to bypass any tool safety barrier.
