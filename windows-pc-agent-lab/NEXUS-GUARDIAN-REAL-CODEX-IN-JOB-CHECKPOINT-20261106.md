# NEXUS Guardian — real Codex CLI inside native Job Object checkpoint
Date: 2026-11-06
Repository: entoni441-prog/mcp-android
Branch: experiment/nexus-guardian-realjob-readonly-20261106
Base: 0dce313ac275499a10edb290e808cb484963a106

## Actual owner's Windows test — PASS
The existing authenticated OpenAI Codex CLI was used, without installation or re-login. This experiment runs only a new diagnostic UUID, with Codex read-only sandbox and a disposable new temp Git worktree. No production project files, running Codex sessions, Windows Scheduler or NEXUS Host were changed.

1. The native Win32 test owner created the task singleton mutex and named kill-on-close Job Object; node.exe was added to the Job before resuming. It durably wrote the epoch0 and budget/Job receipts.
2. Within that exact native Job, an isolated Node fixture verified original owner/child identity, CLI binary path and SHA256, and started a REAL Codex read-only session. A full diagnostic baseline turn completed, establishing a durable Codex UUID.
3. The fixture wrote a PREPARED journal entry and saved the precise UUID, then resumed a second read-only CLI turn. On turn.started it wrote the exact CLI child PID. The test killed only the native Job owner handle it itself spawned.
4. The kernel closed the Job, and both the native-owned Node and second-turn codex.exe PIDs were verified gone. The SHA-pinned native OpenJobObject probe confirmed the named Job no longer exists in this Windows session.
5. The passive admission check established matching task/session/epoch/journal/Job identity, operation PREPARED, and no prior attempt. It still reported REQUIRES_ATTESTATION and canResume=false. Under explicit TEST-only orchestration, the JS ledger consumed exactly one durable epoch-1 attempt; replaying the same attempt was refused.
6. A separate independent TEST-only invocation of the installed Codex CLI resumed that SAME saved UUID in read-only mode. It emitted a matching thread.started UUID, expected marker text, turn.completed and exit code 0. This restart was NOT launched by a native epoch1 Guardian process.

Exact owner Windows result:
```json
{"status":"PASS","test":"REAL_CODEX_INSIDE_EPOCH0_JOB","baselineSaved":true,"secondTurnInterrupted":true,"kernelJobGone":true,"ownedNodeDead":true,"ownedCodexDead":true,"journal":"PREPARED","budgetAttempt":1,"duplicateClaimRejected":true,"resumeSameUUID":true,"resumeCompleted":true,"productionRecoveryEnabled":false}
```

Afterwards the command reported exitCode=0, NEXUS was idle and all five pre-existing Codex-related PIDs remained exactly unchanged. No native Job-owner process remained.

## Independent CI
- https://github.com/entoni441-prog/mcp-android/actions/runs/42224431652
- Windows compiled the native C# owner and statically checked the real read-only fixture and exact-handle runner; mock OS epoch1 shadow acceptance 2/2 PASS.
- Ubuntu journal/restart-policy tests 52/52 PASS.
- GitHub CI did NOT log into, launch or spend any user Codex session.

## Boundaries and future work
- This verifies the SAME emergency sequence with a genuine Codex CLI inside the old native Job and exact-UUID resume AFTER verified OS Job disappearance. The final resumed CLI was launched by a strictly test-only controller OUTSIDE a new epoch1 native Job.
- The 'noFilesystemEffect' test marker is an assertion about the controlled test operation and does not imply the Codex client wrote no local session metadata. Only read-only Codex sandbox execution was requested; no irreversible user project action was authorized.
- Actual native epoch1 admission, worker launch, ongoing ownership, server/provider reconciliation and a reliable resume after an unknown IN_FLIGHT side effect are NOT implemented. The executable 'recover' remains RECOVERY_NOT_ENABLED.
- The 30-minute native-observed stable-window reset, owner phone notification delivery, Windows reboot/logon and Scheduler registration remain pending and require separate acceptance.
- No changes to main, installed NEXUS Host, Gateway, Windows security settings, Scheduler or power.
- A minor subsequent source-only cleanup clears outstanding timers in the test harness after a completed Promise.race. Its syntax is subject to CI; the demonstrated owner-PC PASS used the pre-cleanup harness and has not been re-run unnecessarily.
