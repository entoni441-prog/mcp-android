# NEXUS Recovery Watchdog — Windows Terminal flash fix (2026-11-07)

## Final verified state (15:58 Europe/Rome)
- **Production NEXUS online**: Cloudflare tunnel HTTP 200, Host 0.6.1-next.
- `NEXUS-Recovery-Independent` still registered as an independent OS Scheduler task with the same two triggers (daily repeating every minute + owner logon), least-privilege InteractiveToken, IgnoreNew, 45-second execution cap.
- **Changed only Scheduler Action**, not Host, main, Cloudflare or Windows security:
  - Executable: `C:\Windows\System32\conhost.exe` (genuine Microsoft Windows binary, Authenticode **Valid**).
  - Arguments: `--headless "C:\Program Files\nodejs\node.exe" "C:\Users\krado\Documents\NEXUS\recovery-watchdog\recovery-watchdog.mjs" --once`.
  - Working directory: `C:\Users\krado\Documents\NEXUS\recovery-watchdog`.
- **Read-only health confirmation:** Watchdog `summary.json` at 2026-11-07T14:58:44.595Z shows `HEALTHY`, `hostAlive:true`, `supervisorAlive:true`, `ownerOff:false`. Scheduler last result `0`. NEXUS tunnel HTTP 200.

## Root cause
Owner supplied a photograph of a Windows Terminal with two tabs titled beginning `C:\Windows\System32\Windo...`, appearing briefly about once per minute. Not the minimized persistent `NEXUS Host` window.
The earlier `powershell.exe -WindowStyle Hidden` Scheduler Action **still created a transient Windows Terminal console before its hidden preference was applied**; Windows Terminal default-app compatibility issue, tracked by microsoft/terminal issue #12464 and PowerShell/PowerShell #3028.
`Get-ScheduledTask` confirmed the live minute task was executing precisely the PowerShell launcher with `-WindowStyle Hidden`, `ProcessStartInfo.CreateNoWindow=true` only for its *child*. This does not prevent PowerShell's own console flash.

## Controlled fix and proof
1. Read-only preflight: `conhost.exe` signature `Valid` (Microsoft Windows), Node/script exist and no owner STOP.
2. Created one-shot least-privilege **test task** `NEXUS-Recovery-Headless-Probe-20261107` with conhost headless directly launching the original watchdog, not arbitrary commands. The task exited `0`.
3. Backed up previous production task XML before modifying: `C:\Users\krado\Documents\NEXUS\_backup-recovery-task-pre-headless-20261107.xml`. Earlier original Node task backup also exists at `_backup-recovery-task-pre-silent-20261107.xml`.
4. Changed only production Scheduler Action to the tested one. Exact postcheck confirmed both triggers and user principal unchanged, and old action preserved in XML. No Windows settings/security changes.
5. Multiple independent recurring production invocations completed with Scheduler `LastTaskResult=0`, and watchdog records `HEALTHY`.
6. **Decisive visual automation sample:** UI Automation monitored all WindowsTerminal top-level windows **90 times between 15:56:38.069 and 15:56:52.855 local**, including the exact scheduled run at **15:56:44**, and detected **zero visible Normal WindowsTerminal windows** (`VisibleTerminalEvents: []`). The Task Scheduler result at that moment was `0`.
7. Two earlier **one-shot** test tasks `NEXUS-Recovery-Silent-Probe-20261107` and `NEXUS-Recovery-Headless-Probe-20261107` were **disabled** after the test; the working production recovery task remains **Ready**, enabled.
8. **No live Host failure was deliberately triggered** in this UI fix; the actual ability to recover after an unplanned Host crash remains a separate acceptance test, not yet verified.

## Source of truth and regression prevention
- Branch: `experiment/nexus-universal-minimize-silent-watchdog-20261107`, **main unchanged**.
- Updated `windows-pc-agent-lab/nexus-host/recovery/install-recovery.mjs`: future fresh installs generate the same `conhost.exe --headless` Scheduler Action instead of direct Node/PowerShell.
- Added validation to `install-recovery.test.mjs` ensuring only the trusted Windows System32 `conhost.exe` headless wrapper and the fixed Node/watchdog script are used.
- Real Windows: **11/11** recovery tests PASS; installer JavaScript syntax PASS.
- GitHub Actions CI workflow `nexus-universal-minimize-silent-watchdog`, run `42384030384`, Windows and Ubuntu completed **success** on code commit `e8484d5e5637472968dff36e653e594c0cb30ad2`.
- `conhost --headless` is supported by observed current Windows behavior but its use as a launcher has been noted by Microsoft maintainers as not a promised stable public interface. Retain the task backup and check on subsequent Windows updates. Never modify Smart App Control, PowerShell execution policy or default Terminal application to hide this window.
- **Owner visual confirmation after latest change is not yet provided**. The 90-sample real-window UIAutomation proof is positive but not a substitute for reporting what the owner actually sees if another unrelated flashing task exists.

## Follow-ups
- The Gateway catalog's updated description of universal minimize is separately pending owner-consent-gated publication; Host-side minimization is already live and verified.
- If another window flashes, correlate its process and parent/task identity. Do not assume the NEXUS watchdog once more merely because the interval is similar.
