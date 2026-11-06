# NEXUS Guardian 0.5 — integration acceptance checkpoint

Date: 2026-11-06. Repository: `entoni441-prog/mcp-android`.
Experimental branch: `experiment/nexus-guardian-0.5-integration-20261106`.
Base: `612615caba3fd0e1143415d9c2eeada451f4c77a`.
Production/main/NEXUS Host/Gateway/Scheduler settings unchanged. No service registration, reboot, real Codex invocation or new dependency installation.

## Integrated architecture (experimental test-only path)

Windows native `GuardianJobHost.cs` (existing verified Win32 mutex and Job Object owner) now accepts exactly the bundled `guardian-integration-fixture.mjs` from a Windows-validated `nexus-job-test-*` Temp directory. This is NOT an arbitrary command launcher and does NOT change the installed NEXUS host.

- Native owner holds a named Win32 mutex, allocates `native-epoch-000.json` with FileMode.CreateNew + Flush(true) while still owning the kernel lock, and **only then** launches a suspended child, assigns it to the Job and resumes it.
- The child verifies the native parent's exact PID, its own PID, the active Job receipt and root test scope before starting.
- It invokes the actual `runGuardian` from `guardian.mjs`. Guardian invokes the actual `runManifest` from `controller.mjs`; the CLI is **mock Codex** `guarded-fake-codex.mjs`, strictly isolated to a test Temp directory and without network/API calls.
- Mock Codex records `PREPARED`, then durable `IN_FLIGHT` before the single test file effect. Normal successful run validates the local receipt and creates immutable `COMMITTED`. Crash after effect but before COMMITTED leaves `IN_FLIGHT`: automatic recovery is `STOP / RECONCILIATION_REQUIRED`.
- In the `hang` scenario the exact bundled `hung-controller-test.mjs` executes `runManifest` inside a **live controller process** and deliberately blocks its own JavaScript event loop after the child effect. Its PID-scoped heartbeat stops. Guardian's test fixture observes the stale **controller** heartbeat while both controller and mock CLI processes remain alive and stops its own heartbeat. The native Job watchdog then terminates the entire tree, confirming Job ActiveProcesses = 0. The test asserts the real hung-controller marker, old PIDs gone, unchanged file effect and `IN_FLIGHT`.
- On a second start in the same state directory the native owner immediately rejects `NATIVE_EPOCH_ALREADY_CLAIMED` (exit 17), before another controller is spawned. The claim is durable across process death. This is **fail-closed**, not a completed automatic resume algorithm.
- `guardian.mjs` adds an optional **strict exact-path, test-only** controller runner; its ordinary production path and prior Guardian 0.3 logic are unchanged.

## Verification and evidence

1. Owner's actual Windows machine: first native full-chain mock tests 2/2 PASS; full local regression including existing Guardian, controller, Job Object, journal and policy 87/87 PASS (before the later test-only hung-controller wrapper and epoch receipt changes).
2. GitHub Actions `42194490806` confirmed previous integrated journal mock: Windows and Ubuntu both success.
3. GitHub Actions `42194912054` confirmed native epoch-0 durable claim: Windows and Ubuntu both success.
4. GitHub Actions `42195433187`: new real blocked-controller test and native test suite **10/10 PASS**; Ubuntu policy success; one pre-existing Guardian SIGKILL regression test timed out waiting for `checkpoint.json` (25/26 other regressions PASS). A targeted rerun of **the failing test only** on owner's actual Windows returned 1/1 PASS. To isolate potential Windows CI interference from native stress tests, the CI workflow was separated into independent `full-chain`, `legacy-regression`, and `portable` jobs. Latest CI run `42195876495` initially pending independent confirmation.
5. Owner's Windows after testing: zero matching JobHost/integration fixture/hung controller/mock Codex processes; current Git worktree clean.

## Safety boundaries — NOT delivered yet

- Windows has no Codex command in PATH or standard checked installation locations; REAL Codex CLI integration and restored thread after crash/reboot are **not tested**.
- There is no registered Guardian Windows Scheduler task, no Windows reboot test, and no changes to NEXUS/Cloudflare/main.
- An `epoch=0` durable starting claim exists. **Epoch 1 allocation/recovery, durable resettable restart budget, owner notification, and OS-verified old Job cleanup across Scheduler launches are not implemented.** An unknown `IN_FLIGHT` always STOP. No claim of self-healing after the Guardian itself dies.
- The heartbeat propagation from controller to Guardian is currently in a test-only fixture, not the production Guardian watchdog.
- A local-only unique-file effect test is NOT a general exactly-once guarantee for remote/irreversible operations. Provider-side idempotency or independent reconciliation is still required before any retry.

## Next gate

Before activating a Scheduler task: (a) trusted persistent epoch and restart-budget machinery with 30-minute verified-stability reset; (b) native parent liveness/Job proof bound to next generation; (c) exact saved Codex CLI thread resume with durable operation fencing and owner STOP; (d) actual hung real Codex process acceptance; (e) real owner-logon/reboot acceptance. Current stage is an experimental integration and crash-containment acceptance only.
