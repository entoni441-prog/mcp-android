# NEXUS Live v6 — Windows window manager, production checkpoint 2026-11-08

## Authorized release
- Owner approved the exact R1 `wrangler deploy` consent `bbfba9923c73` for experimental checkout `C:\Users\krado\NEXUS-workspace\nexus-live-window-manager-20261107\windows-pc-agent-lab\nexus-gateway`.
- NEXUS `confirm_action` returned `confirmed:true`, command `c-0e40454642` finished `state:exited, exitCode:0`, Wrangler 4.158.0, uploaded 290.03 KiB / gzip 70.38 KiB, Worker startup 3ms.
- **New production Gateway version** `c1cf05d4-18d1-45e3-9360-7572825c9267`; deployment id `fa90343a-50fe-4e02-b98b-3d4dfd8b2df5`, confirmed **100% traffic** by Cloudflare API. Prior rollback version `42392427-d435-4872-b961-bfc32be6c720` remains available.
- CONSENT_GUARD Durable Object and OAUTH_KV retained. No changes to Host files, owner STOP, main, or Windows security.
- Host `0.6.1-next`, PID `16100`, online via tunnel HTTP 200, no recent reconnects. Host pending owner approvals = 0. NEXUS-Recovery-Independent ScheduledTask Ready, LastTaskResult 0; NEXUS-Host-Run Running.
- New `watch_nexus` called in this conversation, returned `state:active`, `granted:true`, `streaming:true`. Embedded widget appeared. Whether Samsung client loaded v6 from refreshed metadata and whether the window manager works *physically on the phone* still requires owner acceptance.

## Source and tests
- Development branch `experiment/nexus-live-window-manager-20261107`; tested HEAD prior to deployment `5cadd3a91b64a8d96227cce7cae3f7d24c4f63de`; `main` not changed.
- Added owner-visible `Окна ▾` panel in widget with current window list, rechecked exact pid/process/title and explicit tap `Свернуть выбранное`.
- The widget routes solely through existing `list_windows` and `minimize_window({pid,title,ownerRequested:true})`, never through shell mouse/keyboard or run_command; verifies `verified:true` and `shellInputSent:false`. It refuses ambiguous/recycled windows, STOP and owner approval overlay.
- Live UI resource version `ui://nexus/live-view-v6.html` (fresh client cache key), preserving older v5/v4/v3/v2/v1 resources.
- Owner-private Notepad viewing via `Личные окна 🔒` remains available from v5, separately passphrase-authenticated. Unmasked frames must never enter model-visible screenshots.
- Real Windows node regression suite 35/35 passed; final GitHub CI **Windows & Linux PASS** run `42432902634`.
- Persistent Window Terminal NEXUS Host had previously been safely minimized, and a stray `shell_command` handoff canceled; the panel makes this a one-tap owner action independent of console input.
- Independent Recovery Watchdog silent mode using Microsoft `conhost.exe --headless` remains unchanged; user confirmed no further minute flashes.

## Outstanding acceptance
1. Owner may need to refresh NEXUS tools via ChatGPT web if a cached v5 widget is displayed.
2. On Samsung Live v6, select `Окна ▾` -> visible NEXUS Host Terminal or another regular window -> `Свернуть выбранное`. Confirm window minimizes physically, without `owner_handoff_active`.
3. For owner's Notepad, click `Личные окна 🔒`, enter **NEXUS owner passphrase only in the widget**, verify text visible on phone, STOP still protects sensitive screenshots.
4. Avoid redoing known PASS Calculator, Explorer, touch and native keyboard tests. Do not turn on private view without explicit owner entry. Do not close Host or restart/reinstall Windows during acceptance.
5. Later independently implement reliable auto-minimize of **new** NEXUS Host windows on restart/task completion, and owner-initiated Live ▶ resume.
