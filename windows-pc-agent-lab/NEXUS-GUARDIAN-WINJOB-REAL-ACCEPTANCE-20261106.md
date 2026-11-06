# NEXUS Guardian — Native Windows Job Object / OS mutex acceptance

**Date:** 2026-11-06 UTC. **Status:** native isolation and concurrency layer ACCEPTED **for the isolated experiment**; production integration **NOT performed**.

## Source and checkpoint

- Repository: entoni441-prog/mcp-android.
- Branch: `experiment/nexus-guardian-jobobject-20261106`, created from `6d8c707f64116169b1eec9a5305fc8429eca0b92`.
- New native source: `windows-pc-agent-lab/nexus-codex-autoresume/native/GuardianJobHost.cs`.
- Test scripts: `native/job-fixture.mjs`, `native/job-grandchild.mjs`, `native/jobhost.test.mjs`.
- CI workflow: `.github/workflows/nexus-guardian-native-job-ci.yml`.
- No changes to `main`, installed Host/Gateway, Cloudflare, Windows Task Scheduler, startup, permissions or security controls.

## Windows implementation

The helper runs only the explicitly named `job-fixture.mjs` in a fresh `nexus-job-test-*` OS Temp directory. It is deliberately **not a general arbitrary command executor and not yet a registered Guardian runner**.

1. Acquires `Global\\NEXUS-Codex-JobTest-<taskId>` using Win32 `CreateMutexW` with exclusive initial ownership. An existing mutex returns `DUPLICATE_OWNER` (exit 12). Kernel releases the owner on process death; PID files are not used for ownership.
2. Creates a Job Object and sets `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` with no breakaway flags.
3. Creates the test child using `CreateProcessW(...CREATE_SUSPENDED | CREATE_NO_WINDOW)`, with handle inheritance disabled.
4. Assigns the suspended process to the Job Object **before** `ResumeThread`. If assignment fails, the exact owned suspended process handle is terminated with `TerminateProcess` (not an untrusted/reused PID).
5. The child and its detached `CreateProcess` descendants remain in the Job. A fresh PID-scoped heartbeat is monitored; a stale heartbeat while the process is still alive causes Job termination and a bounded check that the Job's ActiveProcesses becomes 0.
6. On unexpected owner SIGKILL, closing the last Job handle by the Windows kernel terminates the owned tree. On ordinary worker exit, any remaining detached descendants are also terminated and accounted for.
7. Writes sanitized, atomic replaceable test diagnostics only into its own Temp directory. No Codex prompts, credentials or external side effects.

Compilation on owner's Windows used only installed `C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe` and Node 24; no SDK, subscription, environment change or new installation.

## Acceptance evidence

**Real owner's Windows:** original native compiled executable passed:
- Normal child exit: `COMPLETED`, Job ActiveProcesses=0, one effect.
- Hung-but-still-alive child: stale heartbeat -> `STOP / HEARTBEAT_STALE_JOB_EMPTY`, ActiveProcesses=0. Exact child and detached grandchild PIDs gone; effect-once.txt appears once.
- External SIGKILL of verified test Job owner: both the child and detached grandchild PIDs gone; effect SHA unchanged.
- Kernel mutex: a second concurrent process with identical task ID is rejected while the original stays alive; after owner SIGKILL, the kernel mutex can be acquired for **a new independent test state**, not replay of the old task.
- A detached grandchild remaining after normal parent exit is terminated by the Job.
- Unsafe/non-fixture script invocation rejected before launch.

**Independent GitHub Actions** run **42189491694** at code commit `c604514fdce301b2e0036da64c391898b7cfbba8`:
https://github.com/entoni441-prog/mcp-android/actions/runs/42189491694

- Windows native test suite: **8/8 PASS**, including deliberately injected Job-assignment failure: the suspended child never executes and is terminated by its exact process handle.
- Windows durable operation journal and restart policy: **51/51 PASS**.
- Ubuntu portable operation journal and restart policy: **51/51 PASS**.
- Final Windows and Ubuntu jobs both `completed/success` and their relevant steps succeeded.

One early Windows automated run encountered `spawn UNKNOWN` for a newly compiled temporary unsigned EXE; reusing a separately compiled verified executable for local tests avoided changes to machine security policy. Independent GitHub Windows Runner compiled the latest source and passed all 8 native tests. The NEXUS connector required explicit consent to repeat an identical manual compiler command, which was respected; no forced repeat was performed.

## Safety boundary and remaining work

- **Verified:** kernel singleton for one process lifetime; inherited Job containment for ordinary and detached CreateProcess descendants; killed tree on stale heartbeat or owner crash; no repeated test effect; suspended-child assignment failure fails closed.
- **Not verified:** arbitrary child creation through Windows WMI/services or processes intentionally launched outside the Job; production-ready Codex/controller identity checks; protection against an external agent touching the heartbeat file; named mutex ACL across all user sessions.
- The helper deliberately accepts only a test fixture. Actual `guardian.mjs`, Codex CLI and persistent scheduler task are **NOT wired into the native helper**.
- `restart-gates.mjs` remains a pure defensive decision function, not an autonomous restart loop. `operation-journal.mjs` is not yet enforced around real external actions. Durable restart budget, epoch allocation, owner-stop propagation and reboot handling require separate integration testing.
- A simulated hanging Node fixture is not a proof of a hung real Codex CLI/controller. That real process is the next acceptance target.
- Never infer exactly-once external delivery from an unchanged local file hash. An unknown `IN_FLIGHT` irreversible operation stays `STOP / RECONCILIATION_REQUIRED`.

## Next safe stage

Connect the native owned-job launcher to a strictly approved, experimental Guardian task without enabling production Task Scheduler. Wire OS-owned mutex + validated unique task directory + task-scoped consent, epoch and immutable journal. Test an actual hung controller/CLI process with no duplicate effect, then separately test reboot and Codex exact-session resume. Registration of a disabled/active Scheduled Task or edits to the installed Host remain outside the present authorization.
