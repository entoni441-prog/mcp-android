# NEXUS ChatGPT Live — old widget cache / v2 corrective checkpoint
Date: 2026-11-07, Europe/Rome.
State: **Patch verified & staged on Windows; deployment AWAITING owner approval**. Do not claim v2 is live yet.

## Reported observation
The owner sent a screenshot of ChatGPT Android Live at ~07:31 Europe/Rome. It shows video and legacy-only controls (pause, FPS, fullscreen, STOP, caption «Только просмотр. Кадры не сохраняются.»). New sections «Подтверждения владельца» and «Доступ после запуска» are absent.

Gateway production version at observation: `8e3735e6-eb73-4e42-9710-f0ea63214b8c`, 100% traffic; `/health` HTTP 200, NEXUS Host online. Read-only comparison of deployed local `src/widget.mjs`: new panel and boot status exist in gateway source. A repeat invocation of `watch_nexus` after deployment still caused ChatGPT to display the **old** widget description «View only; STOP switches the stream off at the PC». The old and new widgets shared `LIVE_UI = ui://nexus/live-view-v1.html`, which is the advertised `_meta.ui.resourceUri` and `openai/outputTemplate` cache key.

OpenAI plugin guidance says to version resource/template URI when the widget UI changes and update the tool descriptor and resources/list/read accordingly. This is a high-confidence cache hypothesis; we have not proven how long the particular ChatGPT mobile client retains cached tool metadata.

## Experimental fix
Branch `experiment/nexus-live-ui-v2-cache-20261107` based on `c2adffca1f98cde3361e3afa643baca167a33fa5`.
- Host+Gateway source catalogs **in this experimental branch only** share `LIVE_UI = 'ui://nexus/live-view-v2.html'` and `LEGACY_LIVE_UI = 'ui://nexus/live-view-v1.html'`. Installed Host was NOT changed.
- Gateway `src/widget.mjs` can render its content with either resource URI while the current tool descriptor points to v2.
- Gateway `src/handlers.mjs` lists v2 before v1, accepts resources/read for both, and keeps the same 44 tools, names, input schemas and OAuth handling.
- Existing per-request owner authentication and CSP in the widget are not modified.

## Acceptance
- On owner's Windows: 44/44 Gateway tests PASS; test suite asserts v2 URI in watch_nexus `_meta.ui.resourceUri` and `openai/outputTemplate`, v1 compatibility and new panel HTML. 
- GitHub Actions run `42347802933`: Windows-latest PASS + Ubuntu-latest PASS; production-shaped Wrangler `deploy --dry-run` and host/gateway catalog byte parity verified in CI.
- All three changed production Gateway files `src/catalog.mjs`, `src/handlers.mjs`, `src/widget.mjs` were staged on Windows using optimistic SHA and three new rollback backups under `C:\Users\krado\.nexus-host\backups`. Prior deployed Worker version `8e3735e6-eb73-4e42-9710-f0ea63214b8c` is the rollback candidate.
- DO NOT modify installed Host or Windows; main remains untouched.

## Pending owner-only gate
NEXUS command plan generated for `wrangler deploy --dry-run` then `wrangler deploy`:
- Consent ID `1fe63a399402`
- Plan SHA prefix `998bc8598bcc`
- Status `consent_required`; **owner must approve once on authenticated /live**, assistant must not self-approve.
- If user approves, `confirm_action` with exact tool target then `command_plan.run` once, poll `command_plan.status`, check Cloudflare new deployment, gateway/host online, v2 metadata after re-discovery.
- Must then test UI on actual Android ChatGPT. Tool descriptor itself may remain cached until refresh/reconnect/new conversation. Do not promise a new live screen merely because deployment passed; only owner screenshot confirms.

## Security
No passwords/PIN are requested in chat; use approved Owner NEXUS /live only. Do not alter security policy or `logonChannelVerified`. Remote pre-login Windows sign-in remains separate and NOT implemented.
