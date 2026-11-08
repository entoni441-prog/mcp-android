# NEXUS natural touch / Live v7 — Host VERIFIED, Gateway approval pending

As of 2026-11-08 02:01Z on owner's Windows PC.

## Owner request
- Ordinary Windows desktop controls including NEXUS Host terminal caption minimize must work directly with a SINGLE TOUCH on the displayed Windows Live screen, not require choosing a window in the extra "Окна" picker.
- Ordinary Notepad is not inherently a secret document: owner Live widget should show it without entering NEXUS owner passphrase. Protected accounts, password managers, security screens and explicitly sensitive resources retain confirmation policies.
- Prior window-manager panel and separate owner-passphrase private view remain accessible ONLY via ⋯ fallback menu.
- User asks for minimal manual interaction and not to redo already PASS Calculator, Explorer, typing.

## Code changes
- New branch: `experiment/nexus-natural-touch-20261108` from prior verified `experiment/nexus-live-window-manager-20261107`.
- Host `uia-script.mjs`: Win32 `WM_GETTITLEBARINFOEX` minimize button rectangle proof (index **2** only), fallback `WM_NCHITTEST == HTMINBUTTON(8)`, exact native top-level HWND and live PID check, short nonblocking `SendMessageTimeout`. No mouse/key/close commands for this case.
- Host `gui.mjs`: uses verified native caption proof or previously verified UIA caption button to route normal tap to existing `WindowPattern` minimization, with strict independent pid/hwnd/process verification. Other Terminal input remains protected.
- Host `live.mjs`: model `capture_screen` remains unchanged and owner Notepad remains redacted to model; **app-only** owner widget `live_frame` now gets ownerCapture direct with a separate buffer (no reuse in redacted frameBytes cache), without a secondary password.
- Gateway UI: Live `ui://nexus/live-view-v7.html` new cache key; previous v6/v5/v4/v3/v2/v1 preserved. Both fallback extra owner-private and backup window manager moved behind ⋯.
- Host & Gateway `catalog.mjs` byte identical.
- No main branch/security policy changes.

## Verification
- Real Windows tests: host 38/38 PASS (including GUI, owner-private-live, universal minimize, C# native-caption proof compilation); Gateway 35/35 PASS.
- OS-owned activation policy tests 3/3 PASS.
- CI Windows/Linux SUCCESS: run `42436505256` on commit `c7c86f98260dd82d6d632538b9541912ea8699e1`.
- Preflight: verified current production Host/supervisor identities and exact old/new sha256 of four files; independent OS Scheduler probe `SCHEDULER_INDEPENDENT_PASS`, PID 26968, followed by one-time arming.
- Independent activator `NEXUS-Natural-Touch-Activation` finished, `C:\Users\krado\Documents\NEXUS\_activate-natural-touch-20261108-state.json` phase `installed_verified` at 2026-11-08T02:00:01.341Z. Backup `C:\Users\krado\Documents\NEXUS\_backup-natural-touch-pre-20261108`. Host PID **5600**, Supervisor PID **10548**. Tunnel reconnected with HTTP 200 and new Host uptime; no pending owner consents (before Gateway request). Scheduler NEXUS-Recovery-Independent Ready, lastResult=0; OS activator lastResult=0.
- Installed hashes:
  - gui.mjs `3b487cfb1b4b3451e8339d7c7a0e515acd76cd87a91a2ffbc9c467d85bb1f0f5`
  - live.mjs `15a5c43c47fa8a4facb0da985f4d211d0894758c025948f71e21ec9b0eebe32b`
  - uia-script.mjs `02044e8c74c778995a30ddab71245772bff5972ff4bf81a573fc9e6f90571d8e`
  - catalog.mjs `e29fa92e76f53d3aab01aaed6fdd4fd57af99c8e9375d323f50c1147dd933890`

## Pending
- **Live v7 Gateway NOT YET DEPLOYED**, still the previously verified v6 production. A pending one-use NEXUS owner approval was created for `wrangler deploy`.
- Consent ID **`f48362a77a4a`**. Exact tool target:
  `выполнить команду (R3: subcommand_not_in_profile): node.exe C:\Users\krado\NEXUS-workspace\nexus-live-window-manager-20261107\windows-pc-agent-lab\nexus-gateway\node_modules\wrangler\bin\wrangler.js deploy   [папка: C:\Users\krado\NEXUS-workspace\nexus-natural-touch-20261108\windows-pc-agent-lab\nexus-gateway]`
- Previous known-working Wrangler v4.158.0 executable is reused from the old staging node_modules; no redundant npm installation. The current worktree contains the new Wrangler config/source.
- Owner must approve on authenticated `https://nexus-gateway.entoni441.workers.dev/live` via "Разрешить" (request expires after 600s). After explicit tap, call `confirm_action` with exact consentId+target, poll run_command status to exit=0. If expired, reissue `run_command` with same exact args, do not reuse stale consent.
- After deploy: verify Cloudflare newest deployment serves 100%, /health 200, /live 200, unauth /mcp 401, Host online, independent watchdog, fresh widget v7.
- **Physical Samsung acceptance not yet done**: tap real NEXUS Host titlebar minimize directly; no `owner_handoff_active`. Confirm plain Notepad displays without password; model `capture_screen` still masks/not leaking. WindowsTerminal custom titlebar may not return native caption proof; if so keep safe fallback, collect exact evidence, do not weaken Terminal shell boundary.
- Do not claim direct touch PASS until owner confirms. No further runtime upgrade without a new checkpoint and safe installer.
