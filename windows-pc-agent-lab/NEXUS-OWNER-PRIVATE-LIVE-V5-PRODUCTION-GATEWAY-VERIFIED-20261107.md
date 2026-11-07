# NEXUS Live v5 — owner-private viewing production Gateway VERIFIED (2026-11-07)

## Deployment and approval
- Owner explicitly tapped **Allow / Разрешить** on NEXUS Live for the exact `node.exe node_modules\\wrangler\\bin\\wrangler.js deploy` permission.
- NEXUS `confirm_action` id `f579148016a2` returned confirmed true, command `c-09b2285c83` completed `exitCode=0`, Wrangler 4.158.0; 280.35 KiB (gzip 68.42 KiB), Worker Startup Time 2ms.
- New **Cloudflare nexus-gateway v5 production version**: `42392427-d435-4872-b961-bfc32be6c720`.
- Cloudflare deployments API verified **100% traffic** to v5; deployment id `6077919f-2b41-40cd-b783-64188a1808f9`. Previous rollback version `f13d6a87-bc1d-451c-a1e4-6a74ddf9cf1a` remains listed.
- OAuth KV Namespace and CONSENT_GUARD Durable Object bindings retained unchanged.
- Host already installed v5 from previous checkpoint, Host 0.6.1-next PID `16100`; NEXUS connection `online`, tunnel HTTP 200, no reconnects in observed window; pendingConsents=0.
- Independent `NEXUS-Recovery-Independent` remains enabled/Ready, last task result 0; `NEXUS-Host-Run` Running. No production main/security changes.

## Endpoint validation from owner's Windows
- GET `/health` HTTP 200 (response length 37).
- GET `/live` HTTP 200 (response length 1375).
- Unauthenticated GET `/mcp` HTTP 401, protected as expected.
- Unit/regression prior deployment: Gateway **40/40** PASS, Host **13/13** PASS; GitHub CI Windows/Linux PASS.
- No real owner-passphrase or document contents collected or requested in ChatGPT.

## Feature and remaining acceptance
- Live v5 is advertised at `ui://nexus/live-view-v5.html`; Live v4/v3/v2/v1 resource URIs remain for compatibility.
- New Samsung widget button **`Личные окна 🔒`** prompts for NEXUS owner passphrase in widget, issues an origin-bound ephemeral ticket for 3 minutes and directs owner-only frames to the widget. Ordinary model `capture_screen` and MCP `live_frame` **remain masked**, verified by tests.
- Owner's ChatGPT client MUST refresh NEXUS tools through web (as mobile plugins UI currently lacks refresh tools) to load v5 metadata, then create a fresh `watch_nexus` resource; older widget occurrence may be cached.
- Physical Samsung owner-private Notepad rendering, STOP handling, token expiry and touch interactions **are not yet physically verified**. Do not claim owner-private visibility PASS until owner confirms it in mobile.
- Do not ask owner to send NEXUS password in chat.
- Next task: one real smartphone Live v5 acceptance with owner typing passphrase directly into widget; only then mark fix as fully completed.
