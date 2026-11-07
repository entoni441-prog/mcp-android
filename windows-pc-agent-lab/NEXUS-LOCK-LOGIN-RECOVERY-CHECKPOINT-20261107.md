# NEXUS — Windows lock/logon/reboot acceptance checkpoint

Date: 2026-11-07 (Europe/Rome). User authorization: "Выполняй" for lock, login, and recovery tests after NX-TM-01.

## Verified

- Initial gateway/Host `connection_status`: `online`, tunnel probe HTTP 200; power capability enabled; Host running NEXUS `0.6.1-next`.
- `power_action({action:"lock",dryRun:true})` returned `accepted:true,exitCode:0` and **actually executed LockWorkStation**. Audit: `2026-11-07T05:43:30.376Z` `event:"power_action", action:"lock", code:0`; `05:43:30.377Z` `tool:"power_action", args:{"action":"lock","dryRun":true}`.
- `system_info({topic:"session"})`: `logonUi:true,lockApp:true,consoleUser:true`, `krado` console session still active. Subsequent independent repeated session query confirms the locked state.
- Connection continued `online`, tunnel HTTP 200, Host reachable **during Windows lock**. Windows reboot/shutdown/sleep were NOT run.
- `power_action({action:"restart",dryRun:true})` reported preconditions `noUnsavedOwnerDocuments:true`, `autostartVerified:true`, `logonChannelVerified:false`; blocker `["logonChannelVerified"]`. The production guard correctly prevented a restart.
- `system_info({topic:"autostart_nexus"})`: `NEXUS-Host-Logon` Ready with logon trigger, `NEXUS-Guardian-Preboot-Watch` Running, NEXUS node processes still present.
- Source `capabilities.mjs` declares `logonChannelVerified:false` as **owner-set only after independent remote login after reboot (CRD/RDP)**. `server.mjs` feeds `caps.logonChannelVerified===true` to the reboot gate. **Merely locking/unlocking does not prove post-reboot remote logon**. Never set true without independent verified evidence.
- Root cause of lock `dryRun` semantic defect in `power.mjs`: `if (['lock','display_off','cancel_shutdown'].includes(a)) return execute(a)` occurs before general dryRun preflight check. Therefore `dryRun:true` executes lock. This can surprise operators and should be fixed separately; explicit user task authorization covered actual lock, but the assistant expected a dry run.

## Status / next valid step

PASS: Windows lock and NEXUS tunnel continuity. BLOCKED: owner login/unlock transition has not been independently observed; reboot remains gated. Only the owner should unlock the protected Windows logon screen with their PIN/password, locally or via an independently configured trusted remote login; NEXUS cannot or must not enter credentials / bypass Winlogon.

After owner unlocks, verify `system_info session` shows `logonUi:false,lockApp:false` and `connection_status online`. Even that will not on its own prove the remote post-reboot login channel; **do not enable `logonChannelVerified` or reboot without independent verification and owner's required approvals**.

Suggested follow-up defect: `power_action({action:"lock",dryRun:true})` should genuinely plan without executing, with unit tests; preserve `dryRun:false` semantics, and record exact safety consequences. No production/main/security changes occurred as part of this checkpoint.

## Unlock acceptance completed (2026-11-07 ~06:53 Europe/Rome)

- The owner explicitly reported unlocking Windows locally. NEXUS then performed independent read-only checks.
- `system_info({topic:'session'})` reported `logonUi:false`, `consoleUser:true`, console session `krado` active, `explorerSessions:[1]`; `lockApp:true` process presence is not alone a reliable proof of continued lock.
- Independent `capture_screen` returned an actual 960x540 Windows desktop (not the Winlogon UI): owner login/unlock succeeded, desktop capture PASS. The visible screen was not written to GitHub.
- `connection_status` returned `verdict:online`, probe HTTP `200`, Host reachable with uptime ~1118 sec; `host_diagnostics` PID `22604`, no pending approvals.
- `power_action({action:'restart',dryRun:true})` still reports `noUnsavedOwnerDocuments:true`, `autostartVerified:true`, `logonChannelVerified:false`; reboot BLOCKED as designed. A successful *local unlock* validates lock/unlock continuity but **not** the independent remote pre-login channel required after reboot. Never toggle the safety flag based on the local unlock alone.
- **Verdict**: LOCK→OWNER UNLOCK→DESKTOP/NEXUS RESTORED PASS; REBOOT / PRE-LOGON REMOTE AUTH NOT TESTED.
