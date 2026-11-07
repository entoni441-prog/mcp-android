# NEXUS — Host restored and independent Recovery Watchdog installed (2026-11-07)

## Verified recovery of the original access
- The owner launched the **existing** Windows Scheduler task `NEXUS-Host-Run`.
- At 2026-11-07 12:04 UTC, MCP `connection_status` confirmed **online**, Cloudflare tunnel HTTP 200, Host `0.6.1-next`, Host PID `24288`; no outstanding approval prompts.
- Original failed Live v4 installer journal `C:\Users\krado\Documents\NEXUS\_activate-live-v4-20261107-state.json`: phase `stopping_host`, last 2026-11-07T09:49:25.582Z. Its last operations were `backup_verified`, `stopping_supervisor`, `stopping_host`; **the updater died as it stopped its own execution environment.**
- Four installed file SHA-256 values exactly match the pre-v4 backup in `C:\Users\krado\Documents\NEXUS\_backup-live-v4-pre-20261107`:
  - server.mjs `d7133271cffd112eae3fe4877800a1979730e3e5b309b9d760333f1e1dbe7737`
  - catalog.mjs `eff2c49ab4b8078c43ed7b5ab9d706269bd054611d34a2e87f92799877ed26b8`
  - gui.mjs `45a577daa93088d957b49359f6050707752c1c7a9f1ab878aad7b784a9e69acb`
  - uia-script.mjs `1ea08d9d738fb78e5eded046c26ed6e1f675639ad00978261dd292f616664bbd`
- So **no file restore was necessary**, installed Host remains the pre-v4 build. Cloudflare Gateway remains v3; main and Windows security settings remain unchanged.

## Independent Watchdog deployment
- Code branch: `experiment/nexus-recovery-watchdog-20261107`.
- Independent checkout: `C:\Users\krado\NEXUS-workspace\nexus-recovery-watchdog-release-20261107`; no existing Host code overwritten.
- On real Windows, `node --test recovery-watchdog.test.mjs install-recovery.test.mjs` = **11/11 PASS**; installer `--check` = `RECOVERY_PREFLIGHT_PASS`.
- Exact existing `NEXUS-Host-Run` scheduler identity checked read-only: Node.js executable with single quoted `Documents\NEXUS\nexus-host\nexus.mjs` argument and owner interactive token.
- First install refused to register XML (Windows Scheduler reported `(1,40) can't switch encoding`). Diagnosed directly; corrected installer in GitHub to emit **UTF-16LE with BOM**, with a fail-closed `--resume` for the partially prepared install.
- Pulled fixed experimental source; code syntax PASS; 11/11 tests PASS again. `node install-recovery.mjs --resume` returned `TASK_REGISTERED_VERIFIED`, exit 0.
- **Installed** separate owner-level Scheduler task `NEXUS-Recovery-Independent`; task has InteractiveToken, `IgnoreNew`, daily trigger repetition `PT1M`, logon trigger, max execution `PT45S`. No elevation or Windows security changes. It runs the installed watchdog at `C:\Users\krado\Documents\NEXUS\recovery-watchdog\recovery-watchdog.mjs --once`.
- Manual `schtasks /Run /TN NEXUS-Recovery-Independent` accepted, exit 0; Scheduler state **Ready**, last result **0**.
- Watchdog wrote a persisted decision in `C:\Users\krado\NEXUS-workspace\nexus-recovery-independent\state.json`: `attempts:[]`, `healthySince:1794053384719` (existing Host healthy). A second invocation within the same minute wrote `ALREADY_EVALUATED_THIS_MINUTE`, proving per-minute duplicate suppression. Healthy state was not reset.
- NEXUS MCP after installation still reports **online**, tunnel HTTP 200, Host `0.6.1-next`, no second Host launch. Existing supervisor and `NEXUS-Host-Run` untouched.

## Safety and remaining verification
- **Installed and scheduler smoke-tested on real Windows:** yes.
- **Actually recovered an offline live Host from a controlled crash using this watchdog:** NOT YET VERIFIED. Do not claim this without dedicated controlled failover and independent observation. Avoid killing the only working remote channel before a separate recovery path is confirmed.
- Windows interactive user session is required; this does NOT remotely unlock Windows or restore network/power on a switched-off PC.
- The Watchdog never executes arbitrary commands; it only requests the existing fixed Scheduler task, at most 3 times in rolling 30 minutes, at least 2 minutes apart, only when Host and old Supervisor PIDs are not running; respects `host-off`. Independent monitor is not a credential-bearing RDP service.
- Potential follow-up improvements: keep previous health summary when duplicate invocation occurs within one minute; manage historical per-minute once files to avoid unbounded growth; test actual Scheduler recurrence and genuine failover under a separately established recovery boundary.
- **Live v4 deployment remains deferred.** The failed in-Host self-terminating updater must not be rerun; build a truly OS-independent update orchestrator before coordinated Host+Gateway release.

## Independent scheduled recurrence confirmed

At 2026-11-07T12:11:44Z the Scheduler **automatically** launched `NEXUS-Recovery-Independent` again; `lastResult=0`. Its local summary was `action:HEALTHY`, `healthy:true`, `hostAlive:true`, `supervisorAlive:true`, `ownerOff:false`. NEXUS MCP remained `online`, Cloudflare tunnel HTTP 200. **PASS: periodic trigger and healthy-state behavior on the real owner's Windows**, independent of manual kick-off. A real outage recovery drill remains unverified and is not attempted while it would risk losing the only working channel.
