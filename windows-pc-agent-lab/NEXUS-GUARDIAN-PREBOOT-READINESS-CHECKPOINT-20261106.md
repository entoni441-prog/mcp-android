# NEXUS Guardian — pre-reboot readiness checkpoint

Date: 2026-11-06, Europe/San_Marino
Repository: entoni441-prog/mcp-android
Branch: experiment/nexus-guardian-preboot-watch-20261106
Base: e4e2be88eba40def3d8076ecd6eee0121706f2ae
Release source commit: 889187e8aac49a07edeb1334d4eaecc67d3ae6bb

## Completed, observed on owner's actual Windows

- Preboot STANDBY watcher scans a separately owned sanitized STOP outbox and writes atomic watch-summary.json heartbeat every ~3 seconds. It does NOT launch Codex, execute arbitrary tasks, send secrets or claim phone delivery.
- Native Windows singleton-mutex launcher compiled and passed tests (5/5 local and independent CI), but is NOT used for installed autostart: Windows Smart App Control blocked this unsigned EXE under Task Scheduler (Win32 0x11C7, HRESULT 0x800711C7). This policy was not changed. PowerShell .ps1 was also blocked by existing execution policy, which was not weakened.
- The installed task uses the existing allowed signed node.exe directly; Scheduler MultipleInstances=IgnoreNew provides single-task-instance enforcement for its own launches. Two repeated Start-ScheduledTask calls kept the exact same watcher PID while polls increased; no second task instance was created.
- Registered only a NEW isolated user-logon task named NEXUS-Guardian-Preboot-Watch, user ANTONI-CHATGPT\krado, Interactive logon, Limited runlevel, AtLogOn trigger, IgnoreNew, RestartCount=3, RestartInterval=PT1M. This new task has been started manually and was observed Running with health OK, ownerStop=false, empty pending queue, canResume=false.
- Source release directory: C:\Users\krado\NEXUS-workspace\nexus-guardian-preboot-release-20261106; release version pinned in release-manifest.json to source commit and script SHA-256 80038b4ba58829ef2d4be0e46c28ce6401c9e3e070639983e48bb18cb3e31a50.
- Persistent watch root: C:\Users\krado\NEXUS-workspace\nexus-guardian-preboot-watch. The current watcher can be verified by reading watch-summary.json; its health includes updatedAt, pid, polls and pending notices.
- Installed watcher is a safe observer, NOT the real enabled autonomous Guardian. OS-owner restart count is CONFIGURED but an actual Scheduler self-restart after watchdog crash has NOT been accepted.
- Existing NEXUS-Host-Logon and running NEXUS-Host-Run tasks were not edited or stopped. NEXUS command capabilities still ownerBans:[power], grants.power=false. No Windows power action occurred.

## Tests

- Owner Windows test suite: 5/5 PASS for standalone watcher, STOP outbox, owner stop and native OS singleton.
- Independent GitHub Actions run 42236597021: Windows 5/5 PASS and Linux 11/11 PASS (one Windows-only test skipped on Linux).
- https://github.com/entoni441-prog/mcp-android/actions/runs/42236597021
- The initial CI runner failed because its Temp ancestor is a Windows junction with a different canonical path; code now rejects symlinked watch root itself without requiring literal identity of every parent. Current release is the CI-accepted revision.

## Delivery channel status

- Connected Gmail can send an email to its own authenticated account: one harmless [TEST] message was successfully accepted by Gmail and had SENT, INBOX and UNREAD labels. This confirms mailbox receipt but NOT a phone push notification.
- Created an enabled hourly ChatGPT conditional-watch automation named 'Аварии NEXUS Guardian' to check NEXUS availability and watch-summary.json and (when STOP is new) send a self-email through connected Gmail. The inline manual dry run read fresh health OK and pending=[] with no alert sent. The scheduled run's future access and its sending/deduplication on actual STOP have NOT yet been accepted.
- Cloudflare account has existing chat-router-relay, chat-router-relay-staging and mailru-mcp Workers; no verified Cloudflare Email Routing destination addresses. No production Worker, secrets, domains or phone settings changed.
- This is an hourly cloud fallback, not immediate delivery. The watcher itself still reports externalDelivery=NOT_CONFIGURED, correctly; no claim of phone delivery.

## Remaining hard gates before unattended Windows reboot

1. Current NEXUS and new Guardian standby task both use Interactive Logon. A cold Windows restart can stop at the login screen with NO remote access until the owner signs in. AutoAdminLogon inspection was requested read-only but NEXUS correctly required owner_phone approval for a Winlogon-related security command (consent_required). Do NOT bypass this gate or enable auto-login without the owner's informed authorization.
2. Do not reboot remotely while Windows unattended login and NEXUS reconnect are unproven. Reboot must be separately approved and tested when the owner can recover access locally.
3. A long-running production recovery supervisor, provider-side reconciliation, phone push acknowledgements and native 30-minute stability-budget reset are not deployed. The successful real-Codex test from e4e2be8 was experimental and independent of this standby task.
4. A genuine end-to-end STOP → scheduled automation → Gmail receipt test is pending. Currently outbox only ingests its own dedicated inbox and is not wired into every experimental Guardian task root.

## Safety boundary

No main or production NEXUS Host/Gateway changes; no Power/Sleep/Reboot; no Windows security changes; no paid resources or secret access; no existing Scheduler task replaced. Only a separate AtLogOn test observer task and user-workspace test files were added.
