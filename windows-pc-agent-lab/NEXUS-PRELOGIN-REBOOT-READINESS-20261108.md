# NEXUS — Windows restart, remote logon before Host, and remote power-on

Date: 2026-11-08, ~13:30 Europe/Rome.
Branch: `experiment/nexus-prelogin-reboot-access-20261108`.
Status: **READ-ONLY PREFLIGHT COMPLETED; REBOOT BLOCKED; NO LIVE OR HOST CHANGES.**

## User's exact objective
Continue from accepted Live v11 on Samsung. Need actual Windows restart and reliable remote entry after Windows boots, including a personal owner-only password/PIN mechanism reachable from phone; later remote shutdown and independent ability to power the PC back on. The ChatGPT inline NEXUS Live should resume after Windows owner login. Never pass Windows credentials through model, MCP tool args/logs, GitHub, or ChatGPT messages. Avoid extra paid services and repeat setups.

## User acceptance / freeze
Owner's latest real Samsung Live v11 E2E: Notepad text input, deleting through the in-widget keyboard panel, window movement/minimize, pinch-zoom and image pan work well enough. **Freeze current Host and Gateway; no more tweaks to widget without a specific regression.** On Samsung automatic keyboard popup does not always appear on field tap, but compact `⌨ Клавиатура` works as an acceptable interim UX. Protected password/PIN input remains unsupported; no false PASS.

## Verified actual PC state (read-only)
- `connection_status`: Gateway OK, Tunnel HTTP 200, Windows Host online `0.6.1-next`.
- OS: Windows 11 **Pro**, build 26200, booted through UEFI, motherboard B550 AORUS ELITE V2.
- NEXUS owner granted `power:true` switch, **not** a bypass of the separate owner-approval and precondition guard.
- `power_action({action:'restart',dryRun:true})`: `autostartVerified=true`, `logonChannelVerified=false`, `noUnsavedOwnerDocuments=false` (unsaved `Notepad`). Blockers: `logonChannelVerified`, `noUnsavedOwnerDocuments`. Restart **NOT RUN**.
- `power_action({action:'status'})`: `wakeDevice=null`, no independent cold power-on channel. Sleep/shutdown cannot safely recover remotely.
- `NEXUS-Host-Logon` is a **user logon** scheduled task, owner `krado`, least privilege. `NEXUS-Recovery-Independent` runs on owner logon and every minute in the **interactive owner session**, last result 0; neither starts before sign-in or controls the secure Winlogon desktop. `NEXUS-Guardian-Preboot-Watch` also triggers on user logon despite its name.
- Current session uses console session ID 2. No independent pre-login service installed for NEXUS.
- RDP: `fDenyTSConnections=1` (disabled), NLA required true, `TermService` Stopped/Manual. Nothing was enabled or reconfigured.
- Read-only service discovery found **no** Chrome Remote Desktop, RustDesk, AnyDesk, TeamViewer or Tailscale host service installed.
- Network: Wi-Fi via USB D-Link DWA-182 is active; Realtek Gaming 2.5GbE Ethernet **disconnected**. NIC is in wake_armed list but there is no working independent Wake-on-LAN sender and the Ethernet cable is disconnected. Do not treat wake_armed alone as verified cold power-on.
- Cloudflare: the account has **zero active zones** (read-only zones list), and Zero Trust Access API returns HTTP 403 `access.api.error.not_enabled`. Cloudflare browser-based RDP cannot be enabled on current resources without new Zero Trust enrollment and a domain. Zero Trust Free signup might request payment details even when free: do not initiate, buy domain, activate plan or supply payment method without specific owner authorization.

## Existing source boundaries / previous checkpoints (do not repeat work)
- `windows-pc-agent-lab/nexus-host/power.mjs` explicitly refuses actual restart without `logonChannelVerified===true`; shutdown additionally needs independent wake device. 60-second non-forced restart/shutdown, 60-second cancel window.
- `windows-pc-agent-lab/nexus-host/install/NEXUS-Host-Logon.xml` requires user `InteractiveToken`, starts supervisor after owner logon. No auth bypass.
- `NEXUS-REMOTE-PRELOGON-CHATGPT-REQUIREMENT-20261107.md` is the precise requirement: inline owner auth after reboot, no model-visible credentials, no automatic Windows login.
- `NEXUS-LOCK-LOGIN-RECOVERY-CHECKPOINT-20261107.md`: Windows lock and tunnel continuity already tested; mere lock/unlock is not proof of reboot login. `power_action(lock,dryRun:true)` has a known bug and **actually locks** Windows: do not call this again casually or for testing.
- Watchdog was verified in prior recovery checkpoint. No need to reinstall/redo it.

## Recommended minimal safe proof path
**Stage A — independent pre-login fallback (owner must explicitly authorize installation):**
1. Prefer Google **Chrome Remote Desktop in persistent Remote Access / Me2Me mode** as an **independent rescue channel**, rather than adding a public RDP listener or a Cloudflare plan/domain. Official Chromium architecture confirms this service can start and connect BEFORE anyone logs into Windows and survives logoff/reboot. Google documentation specifies the encrypted client and direct owner's PIN entry. This adds a purposeful pre-login capability, not a redundant chat agent.
2. Prepare read-only installer plan: signed official host download/verified package, install as Windows service at startup, owner signs in to his already existing Google account via the official browser page, sets a distinct long PIN **only in the trusted Google UI** (never in chat or NEXUS tools/logs). Keep Windows own PIN/password secure; CRD's PIN is a separate factor.
3. Verify that the independent service is present, healthy, correctly authorized, and accessible from Samsung by the owner while the desktop is still active. Then verify ability to reconnect to the **Windows lock/logon screen**, with an explicit owner ready, without changing Windows security policy or disabling Windows password. Never claim this is PASS before real mobile demonstration.
4. The CRD client is a separate trusted screen, **not** the current inline ChatGPT widget. Preserve explicit goal of eventually integrating a trusted owner-only pre-login surface with ChatGPT. Do not falsely promise embedding the browser remote login into an MCP App.

**Stage B — controlled reboot and recovery:**
5. Before reboot the owner saves/closes his unsaved Notepad (do not automatically discard or overwrite without his permission). Recheck `power_action restart dryRun` and actual independent login access on phone.
6. A strict issue exists: existing `logonChannelVerified` is documented as set only AFTER successful remote login after reboot. Do not change flag merely to pass the gate. The FIRST E2E reboot can be initiated personally through the independent owner remote-access screen (or local Windows UI) after user authorizes, then prove pre-login connection and owner entry, followed by NEXUS autostart and `connection_status online`. Only then record `logonChannelVerified=true` through separately authorized settings if appropriate.
7. Acceptance: reboot detected, pre-login independent channel works, owner enters Windows directly on trusted Samsung client, Host/Supervisor and Gateway reconnect without manual restart, new Live in ChatGPT works; preserve old STOP and owner protections.

**Stage C — actual off/on (separate hardware prerequisite):**
8. Shutdown stops the Host and network. With USB Wi-Fi and unplugged Ethernet, remote power-on is currently impossible. Investigate a confirmed independently reachable sender in the LAN and Gigabyte BIOS Wake-on-LAN only if the owner requests; no purchase, no firmware/security change without consent. `wakeDevice` remains null until proven.

## Official primary references
- Chrome Remote Desktop: https://support.google.com/chrome/answer/1649523?hl=ru
- Official Chromium persistent daemon before login: https://chromium.googlesource.com/experimental/chromium/src/+/HEAD/remoting/docs/architecture.md
- Microsoft Remote Desktop: https://learn.microsoft.com/en-us/windows-server/remote/remote-desktop-services/remotepc/remote-desktop-allow-access
- Cloudflare browser RDP prerequisites: https://developers.cloudflare.com/cloudflare-one/setup/secure-private-apps/in-browser-rdp/
- Cloudflare Zero Trust Free onboarding still may require billing details: https://developers.cloudflare.com/cloudflare-one/setup/

## Stop / no changes performed
At this checkpoint: **no Windows restart, power-off, logoff, lock, remote desktop service install, RDP/firewall change, auto-login, activation of Cloudflare Access, new plan or billing action**. Production Host/Gateway/main unchanged. Unsaved Notepad untouched. User approval needed to enable a new persistent remote-access channel; then proceed one verified step at a time.

Next decision: owner authorizes or declines **installation and secured setup of Chrome Remote Desktop Remote Access host as an independent pre-login recovery channel**. The model does not request his Google credentials or CRD PIN.


## 2026-11-08 Chrome Remote Desktop installation attempt

- Owner authorized installation of independent Chrome Remote Desktop host for pre-login rescue. **No reboot and no power settings changed.**
- NEXUS Host online, Gateway tunnel HTTP 200. Previous unsaved Notepad untouched.
- Read-only inspection found **no** Google Chrome `chrome.exe` and **no** CRD Host service/installation.
- Official Google Cloud documentation source MSI: `https://dl.google.com/edgedl/chrome-remote-desktop/chromeremotedesktophost.msi`.
- NEXUS `download_verify`: downloaded 24,616,960 bytes to `C:\\Users\\krado\\NEXUS-workspace\\downloads\\chromeremotedesktophost.msi`; SHA-256 **`1aef26d305b0091bba71589d3caaabe6db5a042648e5801969332086db7c1a90`**. Authenticode **Valid**, signed by **Google LLC**; Mark of the Web retained. Verified installer is staged, not yet installed.
- Attempted ordinary silent MSI installation `msiexec.exe /i <verified MSI> /qn /norestart`: **exit code 1603**, no install success. Read-only Application Event log `MsiInstaller` ID **11925** identifies root cause **Error 1925: You do not have sufficient privileges to complete this installation for all users of the machine**. No CRD service created. No blind retries.
- `whoami /groups`: user belongs to BUILTIN Administrators but token at **Medium Mandatory Level**, Administrators SID **Deny Only**. NEXUS commands are unelevated. Installer requires explicit Windows **UAC elevation** from owner; NEXUS Live in ordinary user session cannot approve secure-desktop UAC itself. Do not disable UAC, impersonate SYSTEM, launch an elevated scheduled task to bypass consent, or expose local credentials to the model.
- **Next action**: owner states whether able to approve a Windows UAC dialog at the physical PC. If ready, launch signed MSI via standard Windows elevation and let owner press Yes locally. Then verify `Chrome Remote Desktop Service` (installed and startup automatic) and proceed with Google account/PIN setup in Google's trusted UI. Do not ask owner to paste Google credentials/CRD PIN in chat. If away from PC, stop without risking lost remote control; a different independently trusted admin-capable channel would be required.
- **State**: installation BLOCKED by Windows UAC; restart remains blocked by `logonChannelVerified=false` and unsaved Notepad. Production NEXUS Host/Gateway/main untouched.
