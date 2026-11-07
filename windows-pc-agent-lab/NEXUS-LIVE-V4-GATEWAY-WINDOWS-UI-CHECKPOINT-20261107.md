# NEXUS Live v4 — Gateway deployment waiting; Windows window behavior

Date: 2026-11-07 (Europe/Rome).
Production Host: v4 four-file activation verified by OS-owned independent Scheduler and SHA-256, Host PID 26236, Supervisor running, Cloudflare tunnel HTTP 200.
Production Gateway: v3 version 7c0a8cb1-cb4d-4aea-850f-79305e900d5a, 100% traffic. **Gateway v4 has NOT yet been deployed.**

## Gateway
- Owner confirmed a previous dry-run request in ChatGPT.
- The exact v4 Gateway Node/Wrangler dry-run command was then confirmed with Host `confirm_action`; command exitCode=0, `wrangler 4.158.0`, upload 264.15KiB / gzip 65.10KiB; bindings: CONSENT_GUARD DO and OAUTH_KV present. No production write.
- Local Gateway unit tests 62/62 PASS.
- The actual `node.exe node_modules\\wrangler\\bin\\wrangler.js deploy` returned an **entirely new** `consent_required` (permission owner_phone). It was initiated **after** the owner's prior 'Всё подтвердил' message, so that message cannot authorize this newer consent. Host diagnostics show pendingConsents=1. **Await owner confirmation of this new exact deployment**. Never call confirm_action until owner approves it; do not simulate approval.

## Windows windows/minimization
- Owner observed a black window flashing at intervals, and asked to minimize the persistent `C:\\Program Files\\nodejs\\node.exe` Windows Terminal window, not close it; also requested general rule: after working with a window, minimize it.
- Task Scheduler `NEXUS-Recovery-Independent` runs every 1 minute with `LogonType=Interactive`, executable `C:\\Program Files\\nodejs\\node.exe`, LastTaskResult=0. This recurring interactive launch **likely** causes the flashing terminal. Correlation is strong by task frequency, although exact visual capture of the transient window has not yet been obtained.
- Windows Terminal process PID 20196 with `C:\\Program Files\\nodejs\\node.exe` title, but the dedicated NEXUS `minimize_window(pid=20196,ownerRequested=true)` returned `status:ambiguous`, 2 candidates with IDENTICAL titles. Reproduced with and without title. No window changed. `window_info(pid=20196)` denied with `app_not_allowed: owner_handoff_required hard_deny`. Do not circumvent GUI policy with generic process/window scripting. Future safe tool improvement: dedupe identical HWND, and support owner-targeted HWND/foreground choice with explicit verification, never kill the terminal or send shell input.
- Tested a dedicated S4U (noninteractive) Task Scheduler task with harmless local-health-only script, not the production Watchdog. Task registration failed at Windows authorization, test task NOT created. Did not change Windows logon/security settings or existing Watchdog. Tested benign VBScript hidden-launcher via NEXUS run_command, but Host policy explicitly hard-denied `wscript`; no attempt to bypass. No installed Watchdog change. Temporary test artifacts moved to recoverable NEXUS trash.
- Default Task Scheduler hidden flag is not a fix for transient console flash; Task Scheduler interactive token attaches console to owner desktop. Microsoft documentation confirms S4U is noninteractive but has permission/access constraints. Do not blindly modify production recovery task at the expense of autonomy.
- The immediate next task after Gateway v4 approval is safe owner-side Samsung widget acceptance and fixing per-window selection without interfering with Host.

## Other
- Existing independent Recovery Watchdog remains scheduled, running healthy and unchanged; Host 0.6.1-next with v4 source files.
- No main or Windows security settings changed. A genuine emergency failover test remains pending, intentionally not performed while the only Host channel might drop.
