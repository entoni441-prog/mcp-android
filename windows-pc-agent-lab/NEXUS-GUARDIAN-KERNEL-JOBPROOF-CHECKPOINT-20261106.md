# NEXUS Guardian — named Win32 Job lifecycle checkpoint
Date: 2026-11-06
Repository: entoni441-prog/mcp-android
Experimental branch: experiment/nexus-guardian-kernel-jobproof-20261106
Base: 3a02388e3c043a7b9fec42748f8525b2287b7442

## Implemented and independently verified
- The test-only native GuardianJobHost creates a named, owner-generated unique Local Windows Job Object and checks that it was created fresh, with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE and neither breakaway limit enabled.
- The exact suspended first child is assigned to that kernel Job and confirmed with IsProcessInJob before ResumeThread. The native owner stores bounded, create-only identity evidence and keeps the Job handle until exit.
- A read-only native `probe` validates task, original native owner PID/start ticks, exact assigned child, Job limits, and Windows session; OpenJobObject reports whether the actual OS object is PRESENT or NOT_FOUND.
- The optional test-only `probe-hold` demonstrates why owner PID death is not enough: a second valid Job handle keeps the Job and child alive after the owner has died; a new observer returns PRESENT and must not recover. Once the last handle closes, KILL_ON_JOB_CLOSE destroys the subtree.
- The read-only Node kernel-job-observation.mjs checks the native probe executable's trusted SHA-256 before calling it. Its NOT_FOUND result is explicitly OS_OBSERVATION_ONLY and canResume=false.
- The passive inspectRecoveryAdmissionWithKernel function combines the earlier task/session, journal and budget checks with the exact native OS probe. Any uncertain IN_FLIGHT side effect remains STOP, and no path ever returns permission to execute Codex.
- Both OS proof APIs are scoped to test-only nexus-job-test-* Temp paths, exact test file names and the current Windows session. The production Guardian/Scheduler and user Codex executables are untouched.

## Acceptance
- Final GitHub Actions run 42209087935: Windows named kernel tests 6/6 PASS, existing Win32/Guardian mock chain 11/11 PASS, admission plus budget 36/36 PASS; Ubuntu journals and recovery policy 72/72 PASS. Both jobs success.
- https://github.com/entoni441-prog/mcp-android/actions/runs/42209087935
- Native C# owner compiled on owner's Windows using the existing .NET Framework compiler. The first local test had 3/4 PASS with one intermittent unsigned-EXE spawn UNKNOWN; independent Windows CI completed all current 6 named-kernel tests.
- No actual Windows reboot or Task Scheduler change was performed.

## Real Codex diagnostic (not an acceptance pass)
- The previously known real Codex CLI had already passed a normal read-only exact-session resume test in the earlier checkpoint 90e77f3.
- A new isolated SIGKILL smoke test was attempted using a fresh diagnostic read-only session. Its orchestration timed out on waiting for child_process 'close' despite the test Codex process no longer being present. It printed STOP KILL_TIMEOUT, and the exact test command was cancelled through NEXUS. Five pre-existing user Codex processes remained; none was killed or modified.
- The test harness was changed to use the actual process 'exit' event rather than stdio 'close', with bounded stream draining and cleanup. This FIX is checked into the experimental branch but the REAL crash/resume test has NOT been re-executed or accepted. The NEXUS repeated-execution consent guard must not be bypassed.

## Remaining safety gates
- A named Job NOT_FOUND observation is bound to the same Windows session and confirms no matching kernel object was available after precise owner/child exit checks. It is not an independent server/provider receipt and does not certify that an unknown irreversible operation was committed.
- Explicit provider reconciliation, owner authorization, durable epoch fencing and a true end-to-end real-Codex post-crash resume are still required before enabling recover.
- The executable recover command remains RECOVERY_NOT_ENABLED, and STOP stays mandatory for unknown IN_FLIGHT work.
- Future Windows logon/reboot and Scheduler acceptance require separate owner permission. NEXUS ownerBans include power.
- No source changes in main, production NEXUS Host, Gateway or Windows security settings.

## Win32 references
- https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-createjobobjectw
- https://learn.microsoft.com/en-us/windows/win32/api/jobapi/nf-jobapi-isprocessinjob
- https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects

## Final revalidation and intermittent regression
- CI run 42209532659: a Windows native lifecycle test initially failed 5/6 after the test Guardian exited with code 21 (CHILD_NONZERO), whereas the heartbeat-stale test expected code 20. The issue was intermittent and cannot be definitively explained by the available evidence.
- Rather than accepting the result or reducing assertions, the integration test now captures bounded exact native/Guardian/controller/mock-CLI diagnostic files on recurrence.
- Follow-up CI 42209809859: Windows named kernel 6/6 PASS, original Win32/Guardian 11/11 PASS, budget/admission 36/36 PASS; Ubuntu policy and journal 72/72 PASS. Both jobs SUCCESS.
- The final workflow also statically verified the real Codex read-only crash diagnostic's JavaScript syntax; it DID NOT run a real Codex CLI on GitHub.
- Link: https://github.com/entoni441-prog/mcp-android/actions/runs/42209809859
- This is a validated isolated kernel-observation stage, not proof of stable production automatic recovery. Treat the earlier CHILD_NONZERO flake as an unresolved test-reliability issue until it is reproducibly explained.
