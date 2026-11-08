# NEXUS Live v11 — deployed, Samsung IME E2E pending

Date: 2026-11-08 12:16 UTC (13:16 Europe/Rome).
Status: **GATEWAY DEPLOY PASS / HOST ONLINE / ANDROID IME USER ACCEPTANCE PENDING**.

- Code branch: `experiment/nexus-live-v11-samsung-ime-20261108`.
- Local checkout Git HEAD at deploy: `6dbe79e65c0615ebf3a94770dd2358d22839a1f8`. After testing, a GitHub-only requirements document was added in commit `9a51d3b1cf2ba69084909132a49d0cf84fb81b99`. The deployed Gateway code predates that documentation-only commit; no runtime code changed.
- Previously verified Gateway unit/runtime regression: **89/89 PASS**. Android input after actual touch has not been validated.
- Owner approved NEXUS consent request `7170b7a2c927`; `confirm_action` returned confirmed true, `wrangler deploy` exitCode **0**.
- Deployed Cloudflare Worker `nexus-gateway` current version **`8282af73-d76e-41e3-ae83-f5ea6e4608f0`**.
- Independent Cloudflare deployment API: deployment `3dc9ebd7-2cb8-44a9-9673-5a084481f3ae`, this version serving **100%** of traffic.
- Worker URL: `https://nexus-gateway.entoni441.workers.dev`. MCP Apps new cache-busting resource URI `ui://nexus/live-view-v11.html`.
- Post-deploy `connection_status`: Gateway OK, Cloudflare Tunnel probe **HTTP 200**, Windows Host reachable, Host `0.6.1-next`, no reconnect/connection lost within observed 15-min window.
- Fresh `watch_nexus` returned `state:active`, `granted:true`, `streaming:true`; Live card delivered in same ChatGPT conversation.
- Existing Host v10.1 unchanged. `main` unchanged, security policy unchanged. Previous v10 Gateway Worker `38a2f14b-724d-4686-8e90-c17b2dfa978e` retained for rollback via Cloudflare deployment history.
- Native Samsung keyboard on *verified ordinary Edit/Document/ComboBox fields*: automatic HTML input focus best-effort; if Android iframe requires direct tap, backup control `⌨ Клавиатура`; text sent as Unicode, Backspace/Enter keyboard actions, IME composition/autocorrect handling.
- **Sensitive password / OTP / PIN fields NOT YET SUPPORTED by v11**. Current Host explicitly blocks those `keyboard_action` requests. User requires Samsung keyboard in these fields, but secrets must **not** flow through ChatGPT tools/calls/logs. Secure owner-to-Gateway-to-Host architecture requirements: [NEXUS-SAMSUNG-SECURE-IME-REQUIREMENTS-20261108.md](NEXUS-SAMSUNG-SECURE-IME-REQUIREMENTS-20261108.md). No weakening of protections.

## Next E2E test
1. Owner views **new** Live v11 card within chat, taps a normal Notepad document field.
2. Observe Android Samsung IME appearing on its own, or tap compact `⌨ Клавиатура` if required.
3. Type Russian text, Backspace twice, retype, Enter. Confirm Windows text changes **without separate Send** and without duplicate keystrokes; review Host audit only if failure.
4. Record real PASS/FAIL. Do not repeat already accepted zoom, window move and minimize tests.
5. Separate dev branch / independent Claude security review before implementing secret owner-only typing; never ask the user to paste passwords in chat.

No further production deployment or Host mutation without a new objective reason and permission.
