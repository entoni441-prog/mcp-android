# NEXUS — universal window minimization and Recovery Watchdog silent launch (real Windows)
Date: 2026-11-07 (Europe/Rome).

## Verified user-visible terminal minimization
- The user sent a photo showing a still-visible NEXUS Host Windows Terminal.
- Fresh connection check: NEXUS online, Cloudflare tunnel HTTP 200.
- `minimize_window({pid:20196,title:"NEXUS Host",ownerRequested:true})` returned `status=minimized, verified=true, hwnd=3212556, shellInputSent=false`.
- **Separate Windows UIAutomation WindowPattern check** immediately and again later confirmed both WindowsTerminal top-level windows minimized:
  - HWND `3212556`, title `NEXUS Host`, `WindowVisualState=Minimized`.
  - HWND `3016000`, title `C:\Program Files\nodejs\node.exe`, `WindowVisualState=Minimized`.
- No shell keyboard input and no terminal processes killed. A future Host restart or owner reopening can display a new window; do not claim any permanent system-wide auto-minimize rule was installed.

## Watchdog flashing window
- Root cause candidate grounded in Task Scheduler: `NEXUS-Recovery-Independent` launched `node.exe` in the owner's interactive desktop every minute. Exact visual origin was not screen-captured; user reported one-minute flashing.
- Previous unsigned native GUI launcher `recovery-silent-launcher.exe` was blocked by Windows application control `0x800711C7`. A separate `.ps1` test was refused by PowerShell execution policy. No security settings changed or bypassed.
- Established supported **signed Windows PowerShell executable** launching existing Node via .NET `ProcessStartInfo`:
  - Scheduler executable: `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`.
  - Options: `-NoProfile -NonInteractive -WindowStyle Hidden -Command` followed by fixed readable local command (not encoded, not an external script).
  - Fixed child executable: `C:\Program Files\nodejs\node.exe`.
  - Fixed script: `C:\Users\krado\Documents\NEXUS\recovery-watchdog\recovery-watchdog.mjs`, argument `--once`.
  - Child `ProcessStartInfo.UseShellExecute=false`, `CreateNoWindow=true`, `WindowStyle=Hidden`, `WaitForExit(41000)`, and returns its exit code. No arbitrary network commands.
- Initial sandbox task registration **accidentally interpolated PowerShell variables** and exit code was 1; diagnosed from exact Scheduler Arguments, corrected by writing the script as a **literal**, and verified that `$ErrorActionPreference` and `$psi.CreateNoWindow` remained unexpanded.
- Separate one-shot `NEXUS-Recovery-Silent-Probe-20261107` then ran automatically via Scheduler successfully, **LastTaskResult 0**.
- Updated ONLY the original `NEXUS-Recovery-Independent` ScheduledTask **Action** to the proven hidden PowerShell command, preserving 2 existing triggers, owner InteractiveToken principal, and least privilege. Existing Node-based Task Scheduler XML saved at `C:\Users\krado\Documents\NEXUS\_backup-recovery-task-pre-silent-20261107.xml`.
- **Production automatic recurrence verified:** 2026-11-07T15:37:44+01:00 and 15:39:44+01:00, `LastTaskResult=0`, `summary.json action=HEALTHY`, `hostAlive=true`, `supervisorAlive=true`, `ownerOff=false`. NEXUS remained online and Cloudflare HTTP 200.
- **Visual test still needed:** only an owner's observation across a minute can conclusively show that no visible flash happens on that desktop. Scheduler action and child explicitly use hidden/no-console options, but do not overstate screen-level verification.

## Universal minimizing across app windows
- Production Host was already independently updated and journal `_activate-universal-minimize-20261107-state.json` confirmed `installed_verified`.
- Four changed files installed with exact SHA-256 checks and backup; safe `WindowPattern` uses verified top-level PID and HWND. Protected credential/login desktops excluded, shell command input still forbidden.
- Real Windows Calculator `minimize_window` returned verified=true (ApplicationFrameHost). Touch simulation `mouse_action` on its own titlebar `Minimize` button returned `done=true,action=minimize,verified=true,shellInputSent=false`. User's Samsung still needs repeat acceptance after server install.
- Experimental branch: `experiment/nexus-universal-minimize-silent-watchdog-20261107`; **main unchanged**. GitHub CI Windows and Ubuntu PASS, 35 focused Windows tests PASS.
- Gateway's updated catalog has **NOT** been published yet: its Wrangler dry-run command was blocked at a fresh owner-consent request, not approved during this conversation. Host already supports universal minimize through the existing compatible calls; the Gateway catalog description/schema still needs a separate consent-gated deployment.
