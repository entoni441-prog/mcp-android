# NEXUS Live v4 — gateway production deployment verified — 2026-11-07

Branch: `experiment/nexus-live-v4-os-updater-20261107`; no changes to `main`.

## Owner approval and deploy
- Owner approved the new exact `wrangler deploy` request on NEXUS /live; `confirm_action` returned `confirmed:true`, decision `allow`, consentId `db7a21504cab`.
- Command id `c-b261f200f5` completed with **exitCode 0**, Wrangler `4.158.0`; upload 264.15KiB (gzip 65.10KiB), Worker Startup Time 4ms; OAUTH_KV and CONSENT_GUARD DO bindings preserved.
- Worker: `nexus-gateway`, URL `https://nexus-gateway.entoni441.workers.dev`.
- **New version** `884e9cc9-d13b-4ff4-a4d7-b5d588e79f57`, verified via Cloudflare deployments API receiving **100% traffic**; deploy id `e5e7914a-5ff3-478c-8de8-ba8c57e57148`.
- **Previous version retained for rollback**: `7c0a8cb1-cb4d-4aea-850f-79305e900d5a`, deployment id `6000af2a-1e8f-4275-a0dd-64d6262071a5`.

## Production validation
- From owner's Windows after deployment, GET `/health` = HTTP **200**; GET `/live` = HTTP **200**; GET `/mcp` without OAuth = HTTP **401** (correctly protected).
- NEXUS connector `connection_status` = **online**, tunnel = HTTP **200**; installed Host pid `26236`, Host version string `0.6.1-next` (Host build identity not changed, but v4 source SHA-256 verified in prior installation checkpoint).
- `host_diagnostics` pendingConsents=0; independent `NEXUS-Recovery-Independent` scheduled task `Ready`, last result `0`, existing `NEXUS-Host-Run` still Running.
- Gateway local interactive unit tests **62/62 PASS** before deployment; Windows+Ubuntu CI PASS for v4 and OS-owned updater in branch.

## Remaining acceptance and UX issues
- **Not yet verified on physical Samsung Android widget after ChatGPT plugin refresh**: double tap, native Samsung keyboard popup, long-lived owner preference, stale_args auto-reobserve and basic click. The current session's NEXUS tool description still says the old watch-only description; refresh plugin to load the new v4 tool/resource metadata. Do not claim Android UI acceptance yet.
- **Windows flashing/Program Files terminal:** owner observed flashing console. Independent Recovery Watchdog runs interactive Node every 1 minute, so transient console is likely from this task but not proven via capture. Tests of S4U least-privilege background probe failed Scheduler task registration, and NEXUS policy hard-denied `wscript`. No security/settings bypass, no changes to working watchdog. Diagnostic temp artifacts moved to recoverable NEXUS trash.
- `minimize_window` on the explicitly requested WindowsTerminal `pid 20196` with title `C:\Program Files\nodejs\node.exe` returned `status: ambiguous` with two identical title candidates; no window changed. Need safe UIA HWND selection/dedup without shell input or killing Host.
- No forced crash test yet of independent Watchdog, to avoid risking only usable channel; real OS-owned v4 activation succeeded and recovered Host after controlled restart.
- Next tasks: refresh the NEXUS plugin, Android v4 owner touch acceptance in a non-sensitive app, then fix flashing and terminal minimization in a separate safely tested branch.
