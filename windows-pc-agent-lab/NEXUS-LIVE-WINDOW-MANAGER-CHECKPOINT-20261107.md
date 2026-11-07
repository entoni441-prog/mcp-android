# NEXUS Live — owner universal window manager, 2026-11-07

## The owner's real complaint
Two near-simultaneous owner photos showed an active, visible Windows Terminal tab running NEXUS Host on TV, but part of the NEXUS Live mobile screen black-masked. Owner could type and use normal apps; touch on terminal resulted in `mouse_action: owner_handoff_active` and inability to close/minimize it. Owner wants minimized windows at task end and independently manageable window actions from Samsung.

## Real host diagnostics and immediate repair (verified)
- Connection `online`, Cloudflare tunnel HTTP 200.
- `list_windows`: WindowsTerminal pid **20196**, title **NEXUS Host**.
- `task_status`: lingering `shell_command` owner handoff `h-d384e3b1d0` in `waiting_owner`, originating from accidental touch in protected Terminal, blocking further touch input. No user shell command was requested.
- **Dedicated safe minimization** `minimize_window({pid:20196,title:"NEXUS Host",ownerRequested:true})` returned `status:"minimized",hwnd:3278092,verified:true,shellInputSent:false`. Host never stopped.
- **Unwanted handoff canceled**, `task_cancel({id:"h-d384e3b1d0"})` returned `state:"declined", paused.input:false,paused.capture:false`; NEXUS state active again. No user input or security setting changes.
- Black overlay on owner Notepad is intentional masking of personal document in ordinary model Live; the v5 **`Личные окна 🔒`** button was still showing the locked state on owner's photo. Owner-private preview requires direct passphrase in widget; no need to collect or mention it in chat.
- Why Host window appears: Host is a long-lived process started in interactive Windows Terminal; normal session cleanup/STOP does not automatically minimize this persistent owner window and restart can create a newly visible terminal. Permanent auto-minimize-on-restart is not yet installed; one-time verified minimize achieved.

## Safe universal owner window control in new Gateway UI
- Experiment branch `experiment/nexus-live-window-manager-20261107` derived from existing production v5 source `experiment/nexus-owner-private-live-20261107`. **main untouched**.
- **Gateway widget only** code change `windows-pc-agent-lab/nexus-gateway/src/widget.mjs`; no Host/source/policy/security changes.
- UI button `Окна ▾`, owner sees list of regular Windows windows, selects one and presses `Свернуть выбранное`. This uses existing `list_windows({includeTitles:true})` and `minimize_window({pid,title,ownerRequested:true})` from updated Host, not mouse/keyboard, shell or `close_window`.
- Safe constraints: explicit owner gesture and `Управление` preference required; latest process/pid/title rechecked immediately before minimizing; ambiguous/missing targets rejected; verify `status`, `verified:true`, `shellInputSent:false`; don't repeat an uncertain action; STOP/teardown clears UI; owner approval dialog takes priority. Secure desktop remains denied by Host. Button can target NEXUS Host, Calculator, File Explorer, browsers, etc., as requested.
- Initial real Windows tests: 23/23 PASS. After a final UI change, **20/20 PASS** subset on real Windows. GitHub CI workflow `nexus-live-window-manager` **Windows and Ubuntu SUCCESS**, latest run `42399604713` on source commit `5cbe7b47e9a7df5ac3e2df5d270d456f6600a92e`.
- Staging Windows workspace `C:\Users\krado\NEXUS-workspace\nexus-live-window-manager-20261107`; `npm ci --no-audit --no-fund` installed 35 dependencies. The copied `package-lock.json` is byte-identical to proven v5 working release; both `package.json` SHA-256 values matched; no global reinstall.
- **Not yet deployed in production, not yet physically accepted on Samsung.** The v5 Gateway is still production version `42392427-d435-4872-b961-bfc32be6c720` until owner-approved `wrangler deploy`.
- Before deployment, request fresh exact owner Live approval for `node.exe node_modules\\wrangler\\bin\\wrangler.js deploy` in staged Gateway folder. After owner approves, verify command exit=0, new Cloudflare deployment 100%, /health=200, /live=200, unauth /mcp=401, NEXUS online and watchdog lastResult=0, keep rollback.
- Current code reuses Live v5 template URI, so owner might need to refresh NEXUS tools in ChatGPT web and create a new widget to avoid stale client cache.
- **User-visible live Host minimization is DONE for current window; full reliability across Host restarts and independent phone button remains pending deployment and acceptance.**
