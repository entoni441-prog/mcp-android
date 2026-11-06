# NEXUS Guardian — actual saved Codex CLI crash / exact UUID resume

Date: 2026-11-06
Repository: entoni441-prog/mcp-android
Branch: experiment/nexus-codex-crash-saved-20261106
Base: 041f5cf7387a7243178c6073ac8ef710202b8e15

## Real Windows result: PASS

The previously installed actual OpenAI Codex CLI, codex-cli 0.166.0-alpha.6, was run through the owner Windows NEXUS connection. No installation, login change, user session manipulation, Scheduler, reboot, or production edits were performed.

An isolated local Git checkout was used with read-only Codex sandbox settings.
1. First CLI invocation created a NEW diagnostic session and completed a marker-only turn. A valid thread.started UUID, marker text, and turn.completed were observed. Thus this session was durably established *before* a crash was injected.
2. A second CLI invocation resumed precisely that new UUID. After turn.started, ONLY the ChildProcess handle the test itself created was terminated with SIGKILL. The test observed SIGKILL exit, and no turn.completed for the interrupted turn.
3. A third CLI invocation used codex exec resume with precisely the same captured UUID and read-only sandbox. It returned the same thread.started UUID, expected marker text, turn.completed, and exit code 0.

Exact observed machine result:

```json
{"status":"PASS","test":"PERSISTED_THREAD_CLI_CRASH","baselineSaved":true,"interruptedTurnStarted":true,"interruptedTurnCompleted":false,"killAccepted":true,"interruptedExitCode":null,"interruptedSignal":"SIGKILL","resumedSameThread":true,"completed":true,"expectedText":true,"resumeExitCode":0,"resumeStderrKind":"NONE","elapsedMs":11354}
```

The test intentionally does not publish or log the session UUID. Five previously existing Codex processes remained at the same PIDs afterwards; no extra test Codex processes were left. NEXUS remained Idle; git worktree clean.

## Why this differs from the previous STOP

The first attempted real crash test killed a *brand-new* CLI thread immediately on thread.started and then waited for child_process close, which can be delayed by inherited stdio handles. It stopped at KILL_TIMEOUT. After a change to await process exit, the follow-up failed to resume the just-created thread, plausibly because it had not yet been durably saved. That failed attempt is not a PASS.

The new acceptance test corrects BOTH preconditions: first complete a new isolated baseline session and then kill its second turn, waiting for exit rather than stdio close. Only this corrected test passed.

## Strict scope and pending gates

- The real Codex CLI thread-resume-after-crash capability is proven for a read-only diagnostic session, not for unknown external side effects.
- Native kernel Job owner death, named Job disappearance, mutex, epoch accounting, and journal policy have separately passed Windows CI under checkpoint 041f5cf. They were NOT all orchestrated around this real Codex test in one transaction.
- The native recover command remains explicitly RECOVERY_NOT_ENABLED. An uncertain IN_FLIGHT operation still requires STOP / independent reconciliation. Do not replay an irreversible effect.
- Production automatic recovery, provider-confirmed COMMITTED verification, notification delivery, durable 30-minute stability reset, Windows reboot/logon and Scheduler registration are NOT accepted.
- GitHub Actions for this branch performs syntax and policy checks only, never authenticates to or executes Codex.
- No changes to production NEXUS Host, Cloudflare Gateway, main, Windows security or power settings.
