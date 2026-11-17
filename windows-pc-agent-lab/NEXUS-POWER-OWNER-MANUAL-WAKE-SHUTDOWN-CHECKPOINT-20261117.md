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

## Required fix (design, not deployed)
Introduce one explicit, distinct mode for owner-authorized LOCAL-MANUAL-POWER-ON shutdown, e.g.
power_action({action:"shutdown",returnMode:"owner_manual_power_on",dryRun:true|false}).
Do not silently reinterpret ordinary shutdown or automatically extend this exception to sleep/hibernate/restart. Existing default mode stays fail-closed.

Admission rules:
1. Owner explicitly requested *shut down this Windows PC now*, acknowledged remote access will disappear, and said they will manually power it on later. Consent is single-action, session-bound, non-reusable and auditable. Input from page/file/agent cannot impersonate owner.
2. Preflight: no unsaved user documents, no owner work at risk, no active tasks or pending critical background operations; no forced close. Keep NEXUS task-end cleanup as needed, but do NOT erase user windows or files.
3. For manual physical recovery, remote wake and remote pre-logon login are NOT prerequisites; remote access must be declared OFFLINE until owner physically boots and signs into Windows. Do NOT claim NEXUS reconnects autonomously before login.
4. Require explicit high-impact shutdown action consent in power_action (or stronger owner-only approval if current host contract demands). A general "continue", an old approval, an app button or a CLI command may NOT substitute.
5. Use orderly Windows shutdown, 60s grace, WITHOUT /f, with supported cancel_shutdown (/a). Log owner approval, mode, start, Windows request acceptance and the loss of connection. Distinguish accepted versus OS shutdown verified and remote wake unavailability.
6. Enforce the same policy at all entry points: power_action, arbitrary run_command invoking shutdown, shell/GUI Start menu, task/plan and any other route. The correct repair is to authorize this distinct safe mode, NOT to slip past the gate with a timer, cursor, scripts or another executable.
7. Do NOT touch the user-prohibited power path to Shelly/PWR_SW. Independent PC S3/S4/S5 sensor remains unverified. Never assume relay OFF means PC off.

## Acceptance criteria (future staging work)
- Default mode with logonChannelVerified=false and wakeDevice=false still BLOCKED.
- Explicit manual-power-on mode: dryRun is a truly side-effect-free plan; shows loss of remote access, no autopower, and exact safeguards.
- Without current owner one-shot approval => BLOCKED. With approval, no unsaved docs, no active work and safe state => may schedule orderly /s /t 60; no /f.
- Presence of unsaved docs/active critical work, stale approval, false owner intent, or an interrupted execution => fail closed.
- After request: record exact Windows acceptance; independent Windows EventLog 1074+6006 can confirm clean shutdown only after reconnection. No false "turned off" claim from mere command acceptance.
- cancel_shutdown before timeout works. User returning and powering on locally restores NEXUS only after normal Windows sign-in / Host startup.
- Unit and real staging acceptance tests; production/main and installed Host untouched until reviewed and explicitly authorized.
- Also regression-test lock dryRun behavior separately.

## Current state/checkpoint
Only specification and evidence saved; NO shutdown requested/executed in this checkpoint, and no permission boundaries changed.
Owner's PC remains on after 2026-11-17 blocked shutdown. Last project recovery checkpoint for Shelly remains in separate staging repository (5ff408f).
