# NEXUS / Codex Guardian 0.3 — real controller-crash acceptance

**Date:** 2026-11-06 (UTC), on owner's real Windows PC.
**Final result:** REAL CONTROLLER SIGKILL -> GUARDIAN -> EXACT CODEX CLI THREAD RESUME -> COMPLETED; **FULL PASS** for a bounded local synthetic effect.
**Scope:** EXPERIMENT ONLY. No production installation, NEXUS Host/Gateway change, Cloudflare update, main merge, Windows service, scheduled task, login or security change.

## Immutable development context

- Repository: entoni441-prog/mcp-android.
- Branch: experiment/nexus-codex-guardian-20261106.
- Base: 2681d7776710f5eec11e28cb5efe364d16b23656, the already accepted Auto-Resume 0.2.
- New: guardian.mjs, guardian.test.mjs, guardian-status.mjs, guardian-status.test.mjs, GUARDIAN.md, separate CI workflow.
- Only a test synchronization condition changed in the existing controller.test.mjs. The original controller.mjs was NOT modified.
- Guardian's permanent one-time claims and state are outside the Git repository, in distinct OS Temp directories. The branch remained clean.

## Safety contract

- Guardian launches only its own controller and observes its actual process close.
- It never replays the initial Codex prompt after a controller crash.
- Rescue is allowed only after a saved UUIDv7, zero prior resumes, a nonterminal state and confirmed absence of the prior exact child PID.
- Existing completion marker is checked before new CLI execution; a live/uncertain PID, wrong Git branch, changed binary SHA, owner STOP or dirty worktree means STOP.
- Durable guardian-resume-claim.json and attempt=1 are recorded before a single exact-session resume.
- No discovered PID is signaled. The only PID force-terminated by the external real test was independently checked as the controller process spawned by THIS guardian.

## Local and CI tests

- Owner's Windows Node 24: **30 tests PASS, 0 FAIL**, sequential full suite:
  controller.test.mjs + pilot-worker.test.mjs + guardian.test.mjs + guardian-status.test.mjs.
- GitHub Actions workflow: nexus-codex-guardian-ci, run **42164327648**, **Windows SUCCESS + Ubuntu SUCCESS (2/2)**:
  https://github.com/entoni441-prog/mcp-android/actions/runs/42164327648
- Prior Windows CI intermittently observed a test-only race: mock child killed after checkpoint but before the durable thread ID was confirmed. Fixed test precondition to await saved threadId, and serialized CI file execution. Recovery implementation was not weakened or modified.
- The NEXUS read-only status adapter was executed against the actual real-test state and returned safe fixed-schema fields.

## Real trial 1 — fail-closed, not counted as the crash test

- Fresh test task: nx-guardian-real-90f546c4.
- The real Codex CLI completed its initial turn before the planned kill, without task completion marker. The controller and Guardian correctly stopped with COMPLETION_UNCONFIRMED, exit code 1.
- Test directory retained, no restart and no deletion of its claims. Worker had written checkpoint and a 33-byte one-time effect, but no complete.json.
- This STOP was the expected safe response to ambiguous completion, NOT a successful controller-crash test.

## Real trial 2 — verified controller crash and automatic rescue: PASS

- Fresh, independent task and state: nx-guardian-real-653f87fe.
- Same already-installed Codex executable SHA-256:
  925c7d0665ffa49b0dcf748e034a805a04da984164ac92301432073b47789b99.
- Authorized experimental Git branch clean; exactly one manifest-approved task.
- Guardian began at **2026-11-06T04:39:48.596Z**, then spawned controller PID **8992**, actual Codex CLI PID **21200**, and a bounded test pilot.
- Before SIGKILL the independent operator verified:
  controller is Node with command line referencing controller.mjs; parent is the guardian Node process;
  CLI is codex.exe at the verified installed path and its parent PID matches 8992;
  state was RUNNING, attempt=0, exact thread ID was recorded;
  worker checkpoint and effect-once.txt existed.
- Exact recorded CLI UUIDv7:
  **01a1af27-e4d4-7550-a7f1-009ec76a33ae**.
- External SIGKILL sent **only to controller PID 8992**. Postkill probes:
  controllerGone=true; old Codex CLI PID 21200 also gone.
- Without a new user turn, Guardian observed controller death and process absence, rechecked guards,
  durably claimed the only rescue, entered RECOVERING, and spawned a new CLI PID **18720** with
  "codex exec resume --json <the exact recorded UUIDv7> <bounded resume prompt>".
- Final state: **COMPLETED**, reason=**COMPLETION_MARKER**, attempt=**1**.
- Both work/complete.json and state/complete.json were present; taskId matched and both declared completed.
- Original effect-once.txt: **33 bytes**, only one effect. SHA-256 BEFORE and AFTER:
  **785f41bd9c047493240d171b593bcdf339a6173ff58881f81d8bb1d0b31dcfec**.
- Guardian NEXUS command ended **2026-11-06T04:40:16.123Z**, exit code **0**, fixed-schema stdout only, empty stderr.
- Read-only process check at acceptance end: controller PID 8992 absent; resumed CLI PID 18720 absent; pilot PID 22100 absent. No leftover test processes.
- NEXUS returned to IDLE. The owner's power capability remains disabled. No Host/Gateway changes.

## Result and engineering boundary

**PASS:** Codex CLI session survives an actual controller process SIGKILL through independently running Guardian, and finishes a synthetic bounded, idempotent test task without duplicating the existing effect.

**NOT PROVEN:** resumption of a Codex Desktop GUI thread, restart of Guardian itself if Guardian crashes, process-tree guarantees for arbitrary descendants, exactly-once external side effects, recovery after Windows restart, resident service behavior, or production task registration.

**NEXUS integration:** the existing NEXUS run_command interface can invoke the experimental guardian CLI and read guardian-status.mjs without changing installed Host/Gateway. This is an opt-in command boundary, not production deployment.

**Final checkpoint:** isolated experiment complete. Production integration remains prohibited until separately approved and scoped; do not merge this branch into main automatically.
