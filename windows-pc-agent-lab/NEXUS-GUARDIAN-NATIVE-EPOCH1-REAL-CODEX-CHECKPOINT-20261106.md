# NEXUS Guardian — real Codex in a new native epoch-1 Job (test-only)

Date: 2026-11-06
Repository: entoni441-prog/mcp-android
Branch: experiment/nexus-guardian-native-epoch1-readonly-20261106
Base: 92b89e8853b6499c922ea8b081e86d84ea1de2b6

## Accepted experiment

On the owner's REAL Windows PC, an isolated, newly created Codex CLI read-only thread was saved inside a native epoch-0 Windows Job Object. Its next turn was interrupted by SIGKILL of only the test owner process. The kernel closed the Job and killed the native-owned Node and Codex processes; the SHA-pinned kernel probe confirmed the old named Job was no longer observable and the old owner/child PIDs were gone.

The external-operation journal remained strictly PREPARED, with no IN_FLIGHT or COMMITTED evidence and no user-facing filesystem effect. The test-only controller durably consumed exactly one recovery-budget attempt for epoch 1. A distinct native GuardianJobHost owner then reacquired the same OS singleton mutex, checked the old Job name and exact owner/child, PREPARED journal, exact saved thread UUID, previous read-only completed baseline, absent owner STOP, durable attempt hash receipt and absence of previous epoch1 or shadow claims.

Only AFTER this admission did the native owner create a create-only native-epoch-001.json claim, a fresh named Job with KILL_ON_JOB_CLOSE and no breakaway, and a suspended Node worker assigned to that Job before ResumeThread. The worker independently checked the epoch1 owner, native job assignment, CLI SHA, same stored UUID and operation journal, then invoked the actual installed authenticated Codex CLI with `codex exec resume --json -c sandbox_mode="read-only" <exact saved UUID>`.

The worker durably wrote an epoch1 test result identifying that same UUID as resumed, with a successful `turn.completed` and the fixed expected text marker. The new native owner observed its child exit 0 and its kernel Job empty. The same epoch1 command was refused on repeat. The original existing five Codex processes were unaffected.

Exact original owner Windows machine result (2026-11-06):

```json
{"status":"PASS","test":"NATIVE_EPOCH1_REAL_CODEX","baselineSaved":true,"secondTurnInterrupted":true,"kernelJobGone":true,"ownedNodeDead":true,"ownedCodexDead":true,"journal":"PREPARED","budgetAttempt":1,"duplicateClaimRejected":true,"resumeSameUUID":true,"resumeCompleted":true,"nativeEpoch1Owned":true,"productionRecoveryEnabled":false}
```

User Windows command returned exit code 0. NEXUS remained idle, with ownerBans=[power], five original Codex-related processes and no new Guardian owners. Test state directories were disposable.

## Negative and independent acceptance

- When an epoch1 budget receipt is not present, the new native launch is rejected before a new native epoch or child is created.
- A synthetic, non-Codex UUID cannot enter the real read-only native epoch1 path even after claiming the budget; the negative native admission test returned STOP, never launched Codex.
- Replaying the same epoch1 claim is denied. The journal IN_FLIGHT test continues to STOP without spending the restart budget.
- The existing `recover` command still unconditionally returns `RECOVERY_NOT_ENABLED`; only the separately whitelisted test-only `resume-readonly` fixture and Temp directory can reach the new path.
- The native runner and exact read-only fixture compile/parse on Windows. Independent GitHub Actions 42227995851: Windows native e1 safety 2/2 PASS, legacy Windows Guardian/kernel tests 11/11 PASS, Linux journal/admission/budget policy 88/88 PASS; all jobs SUCCESS.
- https://github.com/entoni441-prog/mcp-android/actions/runs/42227995851
- Following the real machine PASS, a source-only assertion was added to preserve the previous independent read-only resume test expectations. The real native epoch1 experiment was not needlessly repeated.

## Precise remaining production gates

1. The successful epoch1 test was intentionally coordinated by the manual test harness. Unattended detection, scheduler/job ownership and authorized production orchestration are NOT installed or enabled.
2. The strict PREPARED/no-effect boundary is a controlled synthetic/test receipt. No provider-side reconciliation or deduplication has been accepted for arbitrary real external effects. Uncertain IN_FLIGHT remains a strict STOP, never replay.
3. The read-only fixture and installed Codex path are test-only allowlisted. A production runtime would need signed/pinned complete code and CLI, a secure identity/approval boundary and a durable OS-attested admission transaction.
4. Notifications to owner, continuous 30-minute native stability reset, Windows reboot/logon acceptance and robust owner STOP signalling are still separate engineering stages.
5. No changes to main, installed NEXUS Host, Gateway, Windows security, Task Scheduler or power; no reboot and no production launcher switched on.
