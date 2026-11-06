# NEXUS Guardian — recovery admission evidence checkpoint
Date: 2026-11-06
Repository: entoni441-prog/mcp-android
Branch: experiment/nexus-guardian-recovery-admission-20261106
Base commit: 90e77f33d786b1c4712a1352fa7f5ee192d52701

## Completed
- Implemented a passive read-only recovery-admission.mjs and focused Windows/Unix tests. This is NOT an executor.
- Validates taskId, exact saved Codex UUID, original native epoch, owner PID and lossless Windows start ticks, child assignment receipt, durable budget, owner STOP, completion marker and operation journal.
- Windows DateTime.Ticks are verified as original decimal text, not rounded through JavaScript Number.
- Nonstring IDs and oversized/symlinked native assignment evidence are rejected.
- IN_FLIGHT always leads to STOP/RECONCILIATION_REQUIRED. A spent budget, mismatched session, missing evidence or unknown operation leads to STOP.
- PREPARED and COMMITTED only give REQUIRES_ATTESTATION. A local COMMITTED receipt is not independent provider evidence and a task completion file needs validation.
- No result can trigger Codex, claim a recovery epoch or return ELIGIBLE.

## Acceptance
- Owner Windows local acceptance (including journal and restart policy): 67 PASS, 1 SKIP due to Windows symlink privilege, 0 FAIL.
- GitHub Actions run 42204985126: Windows 84/84 PASS and Linux 23/23 PASS, both SUCCESS.
- https://github.com/entoni441-prog/mcp-android/actions/runs/42204985126

## Critical outstanding gate
- The current native GuardianJobHost uses an unnamed Windows Job Object. On old-owner death, a new owner cannot treat PID absence or JSON evidence as proof of previous OS Job containment.
- Implement and separately accept OS-backed exact Job lifecycle proof; verify external action reconciliation and precise thread continuity before any future recover command is enabled.
- The executable recover mode remains RECOVERY_NOT_ENABLED. Provider-side IN_FLIGHT actions are never automatically replayed.
- Durable 30-minute stability reset, real STOP delivery, actual Codex crash recovery and Windows reboot tests remain pending.
- No changes to main, installed NEXUS Host, Gateway, Windows Scheduler or security settings; no reboot, no power.
