# NEXUS v10 — Host installed / Gateway deployment awaiting owner approval

Recorded 2026-11-08 ~10:45Z. This checkpoint supersedes the deployment-pending notes in the v10 candidate design. **Do not repeat the Host installation.**

## Source and branch
- Branch: `experiment/nexus-titlebar-v10-os-owned-activation-20261108`
- Git HEAD of installed source working copy: `654b536ae5bedbc941a221f4bf57398ee00acf2c`.
- Workspace: `C:\Users\krado\NEXUS-workspace\nexus-live-v9-pinch-verify-20261108` (directory name retains *v9* but checked-out git branch has **v10**). Do not infer source revision from folder name.
- Host candidate: GUI safe titlebar drag/minimize, PowerShell UIA bootstrap using split environment values, unchanged secrets/security policy.
- Latest production Worker before v10: **v9**, Cloudflare version `bc2f1b64-3afa-4bdf-93db-bee657769507`. **v10 NOT yet deployed** at this checkpoint.
- New widget URI after v10 deployment: `ui://nexus/live-view-v10.html`.

## Preflight and owner authorization
- Owner expressly authorized safe Host v10 installation followed by Gateway deployment in this chat.
- Current Host before rollout: online, Gateway 200, `gui.mjs` old hash `3b487cfb1b4b3451e8339d7c7a0e515acd76cd87a91a2ffbc9c467d85bb1f0f5`; `uia-script.mjs` old hash `02044e8c74c778995a30ddab71245772bff5972ff4bf81a573fc9e6f90571d8e`; `policy.mjs` old hash `775a16fe70b24dfc7bf51290f10abbbe0f4bcc3c9d38cac26e2df00852fc6a69`.
- Existing recovery watchdog task `NEXUS-Recovery-Independent` Ready, last result 0.
- Controller `schedule-os-owned-titlebar-v10.mjs --check` returned `PREFLIGHT_PASS` with previous Host PID 22032, Supervisor PID 14192. Installer safety tests 7/7 PASS, old natural-touch installer tests included.
- OS-owned one-use scheduler task `NEXUS-Titlebar-v10-Activation` registered unarmed then independent probe PASS (probe PID 18716), armed and started with the user's permission. Unlike a NEXUS Host tool child, activation ran independently from Windows Scheduler.

## RESULT — VERIFIED
- Activation journal at `C:\Users\krado\Documents\NEXUS\_activate-titlebar-v10-20261108-state.json`: final phase **`installed_verified`**, timestamp `2026-11-08T10:43:04.017Z`. Journal phases: backup_verified, maintenance_armed, stopping_supervisor, stopping_host, installing, files_installed_verified, scheduler_started, installed_verified; health=true, toolsVerified=true.
- Backup folder: `C:\Users\krado\Documents\NEXUS\_backup-titlebar-v10-pre-20261108`.
- Installed exactly 3 files, verified by remote `files_scoped.stat`:
  - `gui.mjs` sha256 `b544780e275a0c4bcb775c115fc28fbc7752217be9b6675b2edb1f4d86cc29c1`
  - `uia-script.mjs` sha256 `df9e938b37f0a4e8013758b9367fb236fe55ce12e396419963da52894e34acee`
  - `policy.mjs` sha256 `f1c5051770de025677bc95466589483f99e0cbce8f92035b664ca777433b6240`
- Host and supervisor recovered, Host PID **23324**, Supervisor PID **13132**. Gateway tunnel probe 200 after temporary Cloudflare 530 while restarting, no more pending consents after installer; Host `0.6.1-next` reachable. No rollback was needed. Watchdog task Ready, last result 0 after restart.
- Post-install `list_windows` returned 4 windows; latest Host diagnostic says Host online, ownerAction null, Live ready.
- Regression before install: Host **90/90 PASS** in selected relevant suite, Gateway **82/82 PASS**, owner-safe installer **7/7 PASS**, PowerShell Win32 C# proof compiled and UIA AST parsed. Post-install Gateway smoke tests **12/12 PASS**. These are NOT Samsung real gesture E2E.
- Legacy old `server-050.test.mjs` still contains unrelated stale test assumptions: expected 43 rather than 45 tools, older cursor coordinate; excluded from green count.

## CURRENT BLOCKER — Gateway publish request pending
- On 2026-11-08 ~10:45Z `wrangler deploy` was requested from `C:\Users\krado\NEXUS-workspace\nexus-live-v9-pinch-verify-20261108\windows-pc-agent-lab\nexus-gateway`.
- NEXUS returned `consent_required` for exact command `C:\Program Files\nodejs\node.exe <same gateway path>\node_modules\wrangler\bin\wrangler.js deploy`.
- Owner must approve *this one exact deployment command* on authenticated `https://nexus-gateway.entoni441.workers.dev/live` → «Подтверждения». Do not approve other pending requests, do not pretend the general chat authorization bypasses this Host guard.
- Approval is short-lived (~600 seconds); if expired, issue a single new deployment request after checking the Host and branch state rather than using stale approval.
- After owner says «Подтвердил»: complete NEXUS `confirm_action` using the **exact current consent ID and target from tool response** in chat, verify exit code 0 and Cloudflare Worker version; then /health 200, unauth /mcp 401, Host online. Invoke `watch_nexus` for a fresh Live v10 widget and ask owner to test titlebar long hold drag and tap minimize.

## Acceptance status
- **PASS**: Live v9 zoom and visual pan on actual Samsung (owner confirmed), guarded Host v10 installation/recovery.
- **PENDING**: v10 Gateway deploy, Samsung E2E **real window move** with 0.5s titlebar hold, tap Minimize without shell handoff.
- Do not call implementation complete until real Samsung E2E confirms no shell commands and no accidental mouse actions.

No main changes, no permanent security policy change, no subscription/payment. Claude remains independent reviewer; ChatGPT main implementer.


## UPDATE — Gateway v10 deployed successfully (08.11.2026, 10:49 UTC)

This section supersedes all above "Gateway pending" statements. Do not repeat this deployment.

- Owner confirmed the exact one-time NEXUS `wrangler deploy` approval in chat.
- Consent `562e322fa3ec` used once; `confirm_action` replied `confirmed:true`, command exitCode **0**.
- `wrangler 4.158.0` uploaded the candidate Worker and deployed its triggers successfully.
- **Current production Worker version:** `38a2f14b-724d-4686-8e90-c17b2dfa978e`.
- **Independent Cloudflare API verification:** latest deployment `c60dd66f-6e3a-4264-bad1-bacd9ca5ef0a`, version above serves **100%**, timestamp `2026-11-08T10:48:49.085645Z`. Previous version `bc2f1b64-3afa-4bdf-93db-bee657769507` preserved in deployment history for rollback.
- Host post-deploy `connection_status`: Gateway ok, tunnel HTTP **200**, Host `0.6.1-next` reachable PID 23324; Host diagnostics online.
- Fresh `watch_nexus` called; `state:active`, `streaming:true`, new app Live inserted in current ChatGPT conversation. Unique MCP resource template `ui://nexus/live-view-v10.html`.
- Other curl HTTP checks were blocked by protective `consent_required` for repetition, **not executed**; do not approve or repeat them merely for diagnostics. This does not affect the directly verified Cloudflare 100% deployment and tunnel HTTP 200.
- **Status:** Host INSTALL PASS; Gateway DEPLOY PASS; **real Samsung E2E for window movement/minimize still PENDING**.

### Samsung acceptance, next action only

1. View the **new** NEXUS Live card, not older v9 in chat history.
2. If Host window hidden, open it normally from taskbar (do not trigger shell actions).
3. Pinch zoom as needed (v9 zoom and visual pan previously owner-verified).
4. On a **blank caption strip** of an ordinary visible window, hold finger ~500 ms until grab, slide, release. Check that the actual Windows window moves (not just the picture); Host audit must say `window_move`, `verified:true`, `shellInputSent:false`.
5. Separately tap the Windows window titlebar **minimize** button '−'. Expected `action:'minimize', verified:true`, no sticky `owner_handoff_active`. If Host cannot verify native caption, expect fail-closed rather than a shell command.
6. Do not reset prior handoff automatically; current Host has restarted with `ownerAction:null`. No further Host/production changes without a separate cause and permission.

Claude's role: independent reviewer for difficult/security-critical failures; ChatGPT remains primary worker.
