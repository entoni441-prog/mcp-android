# NEXUS Guardian — test-only epoch-1 shadow reservation checkpoint
Date: 2026-11-06
Repository: entoni441-prog/mcp-android
Branch: experiment/nexus-guardian-epoch1-shadow-20261106
Base: e5f5c44a881e68831a0077f9e12f15f7b1ecea61

## What is implemented
- A strictly isolated Win32 native owner can start an additional PREPARED-only synthetic fixture. It writes matching native-epoch0, OS Job identity, budget anchor and exact taskId, and journals a PREPARED operation without spawning any Codex process or writing an external effect.
- The test SIGKILLs only the native owner it spawned. Windows KILL_ON_JOB_CLOSE terminates its child. A SHA-pinned native probe confirms the exact old named kernel Job is NOT_FOUND and original owner/child have exited.
- Combined passive inspection validates taskId, same synthetic UUID, OS Job, native epoch, PREPARED journal, owner STOP, previous attempt and budget. OS disappearance gives REQUIRES_ATTESTATION with canResume=false, never actual execution permission.
- The test-only JS ledger consumes exactly one durable attempt. New native subcommand reserve-shadow then reacquires the same global OS mutex and checks that prior owner/child died, the exact old named Job is gone, the operation remains strictly PREPARED with NO IN_FLIGHT/COMMITTED/effect, and budget-attempt-001 has the expected hash-chain receipt.
- Native writes only native-epoch-001-shadow.json with shadowOnly=true, canResume=false. It NEVER creates native-epoch-001.json, starts Codex or enables the executable recover mode.
- Duplicate owner, duplicate native reservation and uncertain IN_FLIGHT operation all STOP. The IN_FLIGHT test does not spend any attempt.

## Independent acceptance
- GitHub Actions run 42223187592: Windows OS/journal/native epoch1 shadow chain **2/2 PASS**; separately isolated original Win32/Guardian regression **11/11 PASS**; Ubuntu durable journal/budget/policy tests **88/88 PASS**. All jobs SUCCESS.
- https://github.com/entoni441-prog/mcp-android/actions/runs/42223187592
- A prior combined runner 42222357345 passed the new 2/2 scenarios and 88/88 portable tests, but two old Guardian startup tests timed out before state creation under the shared Windows runner. Splitting old regression and new shadow acceptance onto separate fresh Windows jobs restored 11/11 without relaxing safety checks.

## Verified before this stage
- Actual existing Codex CLI in an isolated read-only experiment passed a persisted session -> second turn SIGKILL -> exact same UUID read-only resume -> turn.completed; checkpoint e5f5c44.
- The real CLI success and the native shadow recovery are separate tests; they have NOT been executed together in one OS Job with actual epoch1 resume.

## Remaining gates
- Execute actual Codex read-only inside an isolated native Job and observe its exact saved UUID through crash, then connect accepted native recovery-owner arbitration and epoch1 continuation. This stage does not do that.
- A local COMMITTED receipt does not authenticate a real provider action. Unknown IN_FLIGHT remains absolute STOP / reconciliation required.
- Production recover is still RECOVERY_NOT_ENABLED; no Windows Scheduler, reboot, user-login changes, installed NEXUS Host, Cloudflare Gateway or main code modifications.
- No 30-minute OS-attested stability reset, real STOP notification transport or production deployment acceptance.
