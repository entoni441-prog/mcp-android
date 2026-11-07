# NEXUS Live v5 — owner-private Notepad visibility, checkpoint 2026-11-07

## Root cause and requested outcome
Owner's physical Windows Notepad window was visible on TV but blacked out in Samsung ChatGPT NEXUS Live. The Host `capture_screen` returned `hiddenWindows:1, hiddenWhy:"owner Notepad documents (not created by NEXUS) are painted over"`. This is **intentional private document masking**, not UI/remote input failure. Owner wants to see own Notepad on mobile without exposing it to model screenshots.

## Implemented, source
Experimental GitHub branch `experiment/nexus-owner-private-live-20261107`, original main unchanged.

- Host `gui.mjs`: regular model `capture_screen` and MCP `live_frame` stay masked; only separate `frameJpeg(...,{ownerOnly:true})` bypasses Notepad mask.
- Host `live.mjs`: separate uncached private `owner_frame` path, kept apart from regular Live frame cache and model tool.
- Host `server.mjs`: `owner_frame` in OWNER_TOOLS only, **never in model TOOLS**; per-frame Gateway Ed25519 signed `nexus-owner-frame-v1` with nonce, timestamp ±10sec and replay bound, live_view grant/task required.
- Gateway `live-page.mjs`: owner-authenticated /live webpage uses private owner frames.
- Gateway `private-frame.mjs`: separate `/live/widget/private-frame` direct POST with strict web-sandbox Origin CORS, short-lived 3-minute HMAC Bearer token bound to Origin, no cookies, no store, per-frame gateway Ed25519 signature, no logs or model context.
- Gateway `widget-consent.mjs`: uses existing owner password check and one-time challenge from ConsentGuard to issue frame-only ephemeral ticket; no passwords through MCP.
- Gateway `widget.mjs`: Live v5 button `Личные окна 🔒`, explicit owner-passphrase popup (not Windows PIN), preview for only 3 minutes, in-memory token and direct HTTPS frame; standard widget remains masked. STOP/teardown clears preview. Native touch/keyboard maintained.
- Catalog uses new `ui://nexus/live-view-v5.html`; old v4/v3/v2/v1 resources retained for compatibility. No extra account setup required.

## Verification
- GitHub Actions CI run `42394688851`: **Windows and Ubuntu SUCCESS**.
- Real owner's Windows staging `C:\Users\krado\NEXUS-workspace\nexus-owner-private-20261107`: Gateway **40/40** tests PASS, Host **13/13** tests PASS, syntax PASS, OS-owned installer preflight PASS.
- Four Host files installed via independent Scheduler task `NEXUS-Owner-Private-Live-Activation`; 2026-11-07T17:09:00Z `_activate-owner-private-live-20261107-state.json` = **installed_verified**; backup `C:\Users\krado\Documents\NEXUS\_backup-owner-private-live-pre-20261107`. New Host PID `16100`, Supervisor PID `7576`, four SHA-256 hashes verified:
  - `server.mjs` `a3ad268091c2e46ffdf0c460b7610cf1f555e37f3ec044b3d47ee857f8080055`
  - `gui.mjs` `d85973088923880376a5ea85f4eca104c6806db2e08bc31bf8789339ca6adfdf`
  - `live.mjs` `69fc34347ffc6344fdb327f4ca348af4038701e9ccbd4ce9e6b50edde507399e`
  - `catalog.mjs` `83273998eb78048d5469a9b7e5d4ceb77d370da13c8ad2a680a855df6211cc05`
- NEXUS online, Cloudflare tunnel HTTP 200, independent `NEXUS-Recovery-Independent` Scheduler task result 0, `conhost --headless` remains unchanged.
- Gateway staging `npm ci` installed existing lockfile dependency set from previous release, 35 packages, Gateway **40/40 PASS** after install. A `wrangler deploy --dry-run` consent was **cancelled** to avoid duplicate owner approvals; no actual dry-run deployed.

## Currently awaiting user's Live approval
- **Production Gateway version has NOT YET been upgraded to v5**. Current last verified version v4+universal minimization `f13d6a87-bc1d-451c-a1e4-6a74ddf9cf1a`, rollback retained.
- A new `node.exe node_modules\\wrangler\\bin\\wrangler.js deploy` resulted in `consent_required`: consent ID `a545bd0a563e`; exact target:
`выполнить команду (R1: workspace_work): node.exe node_modules\\wrangler\\bin\\wrangler.js deploy   [папка: C:\\Users\\krado\\NEXUS-workspace\\nexus-owner-private-20261107\\windows-pc-agent-lab\\nexus-gateway]`
- Owner must tap **Разрешить** at `https://nexus-gateway.entoni441.workers.dev/live` within ~600 seconds and reply «Подтвердил». Only then call NEXUS `confirm_action` with exact consentId/target, decision allow; do not approve for owner. Check command exitCode 0, Cloudflare new version 100%, /health & /live 200, /mcp unauth 401, NEXUS online, watchdog healthy. Never claim production Gateway v5 succeeded before that.
- After real deployment owner refreshes NEXUS tools through ChatGPT web (Android no refresh tools action) and tests Samsung Live v5 button after entering password directly in widget. Real handset success NOT YET VERIFIED. Do not ask the owner to type passphrase into chat.

## Remaining UX/privacy test
- Verify private frame actually displays owner's Notepad as seen on TV on Samsung (rather than mask), normal model `capture_screen` continues masking, native touch and keyboard work, STOP revokes, 3 min expiry.
- Keep main / Windows security / NEXUS Recovery Watchdog untouched.
