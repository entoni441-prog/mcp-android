# NEXUS Gateway consent-channel UX production release — PASS

Date: 18 Nov 2026, ~09:29 CET. Owner directed production release, separately signed and approved in NEXUS /live/approvals.
Staging branch: `experiment/nexus-consent-channel-clarity-20261118`. Source checkpoint `02375bb`; release source additions include 6ba850a, 0cda677, 967f808, 02375bb.

## Release evidence
- Owner approved plan consentId `e023cb08f0aa` on the signed NEXUS owner page. Host diagnostics returned pendingConsents=1, awaitingOwnerApprovals=0, approvedAwaitingExecution=1, before execution.
- NEXUS `confirm_action` returned confirmed:true, allowing 1-step plan ID `5a6bc64f99c17aa1d70687d14ded27776b113c98046b184442d9f2da9d7b58f4`.
- Cloudflare deployment precheck immediately before release: `b7fd9890-72b1-4d1c-94dc-3a63f07e5cdd`, rollback version `87d93ae5-ab8d-4926-8800-eb52a8e2364a` at 100%.
- `command_plan run` launched exactly one `node.exe node_modules/wrangler/bin/wrangler.js deploy`, NEXUS host plan status: FINISHED, step 0 exitCode=0, at 2026-11-18T08:28:24.297Z.
- Cloudflare authenticated API confirms new deployment `edb07c14-76e3-4ba5-a9d9-b5666c0d941d` at 2026-11-18T08:28:20.612581Z, new version `0735ecfa-c144-407d-ba49-9cf630c42508`, 100% traffic.
- Cloudflare settings bindings unchanged: CONSENT_GUARD Durable Object namespace, NEXUS_TOKEN secret_text, OAUTH_KV namespace, OWNER_PASSPHRASE_SHA256 secret_text; compatibility_date 2026-10-01. No secret values inspected.
- Deployed Worker content read confirms 46 tools including production v11 `logon_attestation`, new `pendingChatConsents` handler/UI signal, and existing `owner_consents` and `owner_decide` routes. No owner signed decision route replaced.

## Live public endpoint checks from owner Windows
- `https://nexus-gateway.entoni441.workers.dev/health`: HTTPS/TLS result 0, HTTP 200. This is the correct Gateway health endpoint.
- `https://nexus-gateway.entoni441.workers.dev/mcp` unauthenticated GET: HTTP 401. Protected.
- `https://nexus-gateway.entoni441.workers.dev/live/consents` without owner cookie: HTTP 401. Protected.
- `https://nexus-gateway.entoni441.workers.dev/live/approvals` without owner cookie: HTTP 200 login page. No privileged approval granted without session.
- `/healthz` returned 404 on Gateway; code review confirmed `/healthz` is the NEXUS **Host tunnel** probe and `/health` is the Gateway health endpoint. Not a regression.
- NEXUS Windows Host remains `0.6.1-next`, tunnel health `ok` with zero reconnects, zero pending consents, zero owner approvals, observed after release.
- Cloudflare authenticated API reconfirmed new version `0735ecfa-c144-407d-ba49-9cf630c42508` remains 100% after endpoint tests.

## Scope and rollback
- Live UX now distinguishes requests that require chat consent from owner-signed /live approvals. It does not authorize chat-tier repeats via owner channel and does not bypass platform tool safety.
- No live Windows Host code or settings, main, Shelly, FASTGate or PC power relay modified by this release.
- Existing Gateway and owner approval security constraints retained; previously verified staging gateway suite 52/52 PASS, dry run PASS.
- If a future regression appears, rollback Cloudflare Worker deployment to prior version `87d93ae5-ab8d-4926-8800-eb52a8e2364a` at 100%, with fresh verification.
- Browser-based authenticated owner UX after release was not manually exercised; public routes, protected endpoints, bundle content and Host connectivity were verified. Avoid claiming completed owner-login UI E2E.

CHECKPOINT: NEXUS_CONSENT_UI_PRODUCTION_DEPLOY_PASS; NEW_VERSION_0735ECFA; ROLLBACK_87D93AE5; HOST_STABLE.
