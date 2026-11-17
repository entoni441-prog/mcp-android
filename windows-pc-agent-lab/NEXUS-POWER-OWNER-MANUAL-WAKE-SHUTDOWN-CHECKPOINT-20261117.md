# NEXUS checkpoint — owner-authorized shutdown with manual physical power-on
Date: 2026-11-17. Status: **OPEN / SPEC ONLY / NOT IMPLEMENTED**.
Repository: entoni441-prog/mcp-android; experimental branch experiment/nexus-recovery-watchdog-20261107.
Scope: NEXUS Windows power_action admission logic, NOT Shelly or PC power-gateway.
Do NOT modify installed Host, main, production, Windows security settings or live grants without separate approval.

## Owner request and observed blocker
- Owner asked on 2026-11-17 to shut down Windows while away from home, explicitly stating they would return and switch the PC on **physically themselves**.
- Immediately before, windows were safely minimized and NEXUS GUI session finished; unsavedOwnerDocs=[].
- NEXUS power_action shutdown dryRun:true and then dryRun:false both reported:
  noUnsavedOwnerDocuments=true; autostartVerified=true;
  logonChannelVerified=false; independentWakeDevice=false;
  blockers=[logonChannelVerified,independentWakeDevice].
  dryRun:false => status=BLOCKED, executed=false. PC was NOT shut down.
- This policy assumes remote wake and remote pre-logon access even when owner consciously chooses manual physical return and accepts being offline. It lacks a legitimate owner/manual-power-on path.
- Do NOT confuse absence of remote wake with absence of ability to power on locally. Do NOT set logonChannelVerified=true falsely.

## Independent Windows evidence: previous shutdowns DID occur
Read-only Windows System Event Log verified Nov 17 via Get-WinEvent:
1. 2026-11-08 04:26:31 local — User32 event 1074: action to power off initiated by process StartMenuExperienceHost.exe. This supports a Start-menu-origin shutdown; cannot prove whether mouse, touch, or keyboard selected it.
2. 2026-11-09 08:48:21 local — User32 event 1074: Windows shutdown initiated by C:\Windows\System32\shutdown.exe under owner Windows session.
3. 2026-11-09 08:49:30 local — EventLog event 6006: Windows Event Log service stopped normally. This is consistent with completed orderly shutdown. It is stronger than merely seeing shutdown.exe exit code 0, though independent wall-power state was not monitored.
4. Earlier assistant conversation named shutdown.exe /s /t 60 (60s timer). Event 1074 confirms the executable, NOT its exact CLI arguments or interval. Treat the /t 60 detail as prior conversation/report, not separately proven from the Event Log.
These are TWO different Windows initiating processes, not evidence of a safe NEXUS bypass policy.

## Source diagnosis
Read-only source: workspace root nexus-livev11-pre-attest-power-20261108.mjs, function createPower.plan():
- For shutdown it unconditionally requires f.logonChannelVerified===true and !!f.wakeDevice.
- execute(shutdown) dispatches Windows system shutdown.exe with /s /t 60, without /f, allowing shutdown /a cancellation.
- Current deployed power_action preflight on Nov 17 matches these two blockers. The 2026-11-08 file is historical evidence, NOT proof it is byte-identical to installed Host.
- Previous issue NEXUS-LOCK-LOGIN-RECOVERY-CHECKPOINT-20261107.md requires real proof before setting logonChannelVerified=true for REMOTE login. Preserve that rule unchanged for remotely autonomous restart.
- Also preserve separate known defect: lock dryRun:true may actually execute LockWorkStation. Do not combine that fix with the shutdown mode without tests.

## CORRECTION FROM OWNER (2026-11-17): direct shutdown must not require remote recovery
**This section supersedes the previous extra "owner_manual_power_on" mode and its additional approval requirements.** The owner explicitly rejects restrictions they never requested. During this conversation the owner used their own remote-control software and shut Windows down successfully. The PC was OFF at the time of this correction (owner-reported, not remotely verified).

**Root design error:** The developer/assistant imposed a requirement for remote wake and a separately verified remote login channel on the **shutdown action**. Those conditions are relevant to guaranteeing an autonomous return online; they are NOT required to obey a direct authenticated owner request to shut Windows down. Their unconditional enforcement was an unjustified restriction of owner control. Do not call it a Windows limitation.

### Correct required behaviour (future staging implementation)
1. A direct authenticated user instruction such as "выключи компьютер" **IS the owner authorization** to perform ordinary Windows shutdown. No extra owner-phone approval, special shutdown mode, remote-wake requirement or pre-logon verification is required unless the owner explicitly configures such a restriction later. The assistant should not force the owner to supply repetitive confirmations for the same action.
2. NEXUS power_action({action:"shutdown",dryRun:false}) should perform ordinary, NON-FORCED Windows shutdown when the owner explicitly requested it, even when logonChannelVerified=false and independentWakeDevice=false. These flags must remain truthful and are NOT set or overridden.
3. Default dryRun:true remains strictly non-mutating and explains the loss of remote connectivity; if the owner already requested shutdown, a direct dryRun:false may follow preflight without another confirmation. Preserve a reasonable cancellable 60-second standard shutdown timer, with no /f; Windows itself may surface save-work prompts.
4. Check for unsaved user work and active critical processes; do not silently discard files, force terminate apps, reboot, wipe, or mutate security configuration. If there is a real evidence-based risk of data loss, stop or ask about that specific risk — not a hypothetical inability to reconnect.
5. State once that remote control will be unavailable until the owner physically turns the PC on and signs in. This is an informative consequence, **not a blocker**. The owner controls when to power on. No promise of unattended remote reconnect before login.
6. Do not bypass a currently deployed gate by sneaking shutdown.exe through run_command, a GUI, encoded PowerShell, task scheduler or other route. Correct the gate in staging and test it first; deploy only in the owner's separately authorized release.
7. Do not extend this shutdown exception to unattended autonomous restart, sleep/hibernate or physical PWR_SW without their own validated design. Shelly remains unrelated and disabled.

### Tests and acceptance
- With owner-requested ordinary shutdown, no unsaved work, and logonChannelVerified=false, independentWakeDevice=false => GO for Windows standard shutdown.
- A second "manual return" mode or additional phone consent is NOT necessary; reusing an old instruction for a different future shutdown is forbidden.
- No owner shutdown request => BLOCKED. Unsaved work or other specific high-risk active task => defer/ask, not force.
- dryRun:true sends no shutdown request, dryRun:false after valid user intent sends exactly one; no /f; 60 seconds to cancel with shutdown /a.
- Report Windows API acceptance separately from OS's completed power transition. Verify with EventLog 1074/6006 when online again; owner-reported off state must be labeled as such.
- No change to logonChannelVerified=false or the separate remote-login recovery requirement for unattended restart.
- Unit tests in experiment and real staging acceptance before changing installed Host. Production and main remain untouched.

## Current state/checkpoint
Only specification and evidence saved; NO shutdown requested/executed in this checkpoint, and no permission boundaries changed.
Owner subsequently reported shutting Windows down successfully through another remote access method. This specification records that statement; the agent did not perform or independently verify that shutdown. Last Shelly staging checkpoint remains 5ff408f.
