# NEXUS universal minimize — Gateway metadata activation checkpoint (2026-11-07)

## Verified before deployment
- User reports 1-minute flashing terminal has stopped after scheduled NEXUS Recovery Watchdog switched to `conhost.exe --headless`.
- NEXUS connection `online`, tunnel HTTP 200; independent `NEXUS-Recovery-Independent` `Ready`, last result 0. No new Windows security changes, no production Host changes this turn.
- Host already has universal top-level window `minimize_window`, tested in real Windows Calculator, and safe caption touch routing. Exact owner and secure desktop restrictions remain.
- Current Cloudflare `nexus-gateway` version `884e9cc9-d13b-4ff4-a4d7-b5d588e79f57` (Live v4) serving 100%; previous v3 retained.
- Target branch `experiment/nexus-universal-minimize-silent-watchdog-20261107`; working copy `C:\Users\krado\NEXUS-workspace\nexus-universal-minimize-20261107`, clean, synced to `bac0540`.
- Exact comparison between deployed-source Live v4 branch and target Gateway `src/catalog.mjs`: **only one line differs**, the `minimize_window` description/schema (universal window, optional HWND); no OAuth or Worker logic changes. Node-based Gateway tests `owner061.test.mjs`, `handlers.test.mjs`, `widget-interactive.test.mjs`: **25/25 PASS**.
- CI on experimental branch Windows and Ubuntu PASS.

## User approval currently required
- Issued `node.exe <v4-workspace>/node_modules/wrangler/bin/wrangler.js deploy` in working directory target branch Gateway; NEXUS tool returned `consent_required`, **not run**. Requires explicit owner approval through `https://nexus-gateway.entoni441.workers.dev/live` for the exact `wrangler deploy` command. Consent ID `72d50cf32c16` expires in 600s from request. Do not bypass owner approval or assume it was granted.
- After owner says approved, call `mcp__NEXUS___Windows_PC__confirm_action` with the exact pending target, then poll command status, verify Cloudflare deployments API new version 100%, verify `/health=200`, `/live=200`, `/mcp unauthenticated=401`, NEXUS online and Recovery Watchdog healthy. Update checkpoint with exact version ID and rollback.
- After Gateway deployment, ChatGPT user may refresh NEXUS tools through web (Android UI lacks tools refresh) to see updated `minimize_window` optional HWND schema. No need for account reauthorization.
- Next separate backlog: self-service Live ▶ resume task within owner permissions, automatic window minimizing/cleanup, and controlled genuine watchdog failover drill. No changes without staging and testing.
