# NEXUS Guardian — durable restart budget, STOP outbox and existing Codex CLI

Date: 2026-11-06. Work is isolated in GitHub branch `experiment/nexus-guardian-budget-20261106`, based on `9ae9cec828b6ba233a9fe5809d8d144625798e0b`.

## Verified results

- `recovery-budget.mjs` is an isolated durable accounting fence, **not** an automatic executor. First write creates an immutable task anchor. Each attempt uses fsynced exclusive hard-link publication and a hash-chained, indexed receipt; one attempt is consumed before its worker may start.
- Five recovery attempts are available. Concurrent claims for the same epoch admit only one. On an actual isolated worker SIGKILL, a new reader observes the consumed attempt and cannot reissue it at the same epoch.
- Malformed, missing-intermediate, unknown or unconfirmed receipts fail closed. Plain filesystem records do not defend against a privileged actor removing all ledger evidence; this is not a cryptographically trusted storage service.
- The 30-minute stable-window assessment requires same-boot and continuously verified Job/heartbeat evidence. It **cannot reset the persisted budget**; the OS-attested reset implementation is still pending.
- `stop-outbox.mjs` durably queues sanitized `STOP` reason/epoch/task receipts without embedding secrets or falsely claiming a phone notification was delivered. No transport or sender is enabled.
- Owner's Windows local unit tests: **22 PASS, 1 SKIP, 0 FAIL**. One symlink test required a Windows privilege absent locally.
- GitHub Actions CI **42201978882**: **Windows 23/23 PASS**, **Ubuntu 75/75 PASS**. https://github.com/entoni441-prog/mcp-android/actions/runs/42201978882

## Actual Codex availability, not a new installation

The existing OpenAI Codex desktop installation contains a standalone `codex.exe` in its application-local `bin` directory; it is simply not registered in the PATH. The installed CLI reports `codex-cli 0.166.0-alpha.6` and `Logged in using ChatGPT`.

A **real** existing CLI was invoked twice in an isolated experimental Git branch:
1. `codex exec --json --sandbox read-only` with a diagnostic-only prompt. It returned a valid `thread.started`, expected text `NEXUS-CODEX-PING`, and `turn.completed`, exit code 0.
2. `codex exec resume --json -c sandbox_mode="read-only" <exact test UUID>` returned the **identical** `thread.started.thread_id`, expected text `NEXUS-CODEX-RESUME.`, and `turn.completed`, exit code 0.

The raw thread UUID is intentionally not published in the repository. Both diagnostic invocations returned successfully, did not edit working files, and left no extra Codex processes; the user's existing five Codex-related processes remained untouched.

This verifies the independent CLI and exact-session resume **in a normal, non-crash run**; it is NOT proof of automatic post-Guardian-death recovery, reboot recovery, or operating within the Job Object.

## Explicit remaining gates

1. The live native `recover` path still returns `RECOVERY_NOT_ENABLED`; do not enable or silently retry it. Previous stage CI for this safeguard: **Windows 63/63**, **Ubuntu 52/52**, https://github.com/entoni441-prog/mcp-android/actions/runs/42198841468.
2. Connect the durable budget and STOP outbox to an authenticated OS-owned Guardian admission and a verified owner-notification delivery channel. Do not treat arbitrary booleans, timestamps, local receipts or PID absence as independent proof that the old Job tree is gone.
3. Implement native OS-attested 30-minute continuous uptime and a durable reset, still fail closed on reboot/clock discontinuity. No unsafe reset now.
4. Acceptance: one precisely identified Codex session after a real process crash, with no replay of uncertain `IN_FLIGHT` side effects. This has **not** been completed.
5. Later, with separate owner permission, validate Windows logon and actual reboot, and register a Scheduler task; currently user forbids NEXUS `power`. No reboot or production Task Scheduler changes were made.

## Boundaries

No production/main/Gateway/NEXUS Host modifications; no new Codex installation; no paid subscription or new account; no desktop GUI manipulation. Changes are confined to experimental Git branch and local sandbox tests. All remote owner programs and installed NEXUS Host were left running.
