# NEXUS — consent channels UI visibility staging (2026-11-18)
Branch: `experiment/nexus-consent-channel-clarity-20261118`
Base checkpoint: `6ba850a` (Host diagnostic `pendingChatConsents`, 19/19 targeted PASS)
Status: **STAGING ONLY. DO NOT DEPLOY OR RESTART WORKING HOST/GATEWAY WITHOUT USER'S EXPLICIT PRODUCTION AUTHORIZATION.**

## Root cause
- Host `consent.requestGrant` creates a 120s **chat-only** grant for repeated external operations (`what: arbitrary_command`, `alreadyDone`). It is `owner:false` by design.
- `ownerList()` filters to `owner:true`; therefore `/live/approvals` showed "no pending" despite `host_diagnostics.pendingConsents=1`.
- This was NOT a sync or Cloudflare outage. Repeated SSH/Termux read-only Shelly probe could not be completed because a separate platform guard blocked `confirm_action`; changing wording or route to evade that restriction is prohibited.

## Staging implementation
- Gateway `src/live-page.mjs` `GET /live/consents` still requires owner session and still returns only `owner_consents` as actionable `pending`.
- Read-only `host_diagnostics` adds numeric `pendingChatConsents` in the same owner-session-protected response, with backwards-compatible fallback using total `pendingConsents - ownerPending.length` for installed old Hosts.
- If diagnostic fails, numeric chat status is null/unknown, NOT incorrectly reported as zero.
- Separate `/live/approvals` and full `/live` now display a clear informational note that chat-only requests need consent in ChatGPT and **cannot** be approved by this page. No new `/live/decide` buttons or owner_decide operations are created for chat-tier requests.
- No changes to OAuth, signing, passwords, token handling, nonce TTL, sensitive tool catalog, owner gates or powers.
- Works with currently installed Host's old diagnostic schema as fallback; no Host update required for the UI visibility patch.

## Real test results (Windows NEXUS)
- First focused gateway suite: 11/11 PASS (owner page, signed decisions, widget owner restrictions, 4 new routing tests).
- Extended Gateway targeted core suite: **50/50 PASS**, exit 0, including authorization, credential lockout, anti-replay, security, Live, routing.
- After additional Live viewer informational note: **10/10 PASS**, exit 0; includes new actual rendered page JS syntax test.
- `node.exe --check .../nexus-gateway/src/live-page.mjs`: exit 0.
- Surgical `git apply --check` PASS for both patches; actual diff limited to one `src/live-page.mjs`, 21 added/2 deleted lines, and 2 new test files. No redacted source full-file rewrite.
- Prior unrelated Host regression suite: 4 pre-existing failures (stale catalog counts, pointer coords and minimize error text), not retested/fixed in this UI scope.
- `wrangler deploy --dry-run` did **NOT** execute: NEXUS returned `consent_required` with `what: security_command`, `approval: owner_phone` requiring signed owner confirmation at /live; not approved at this checkpoint. Do NOT treat tests as deployment/build acceptance.
- `npm.cmd` not on NEXUS PATH; tests were run successfully through existing `node.exe`. No installation needed.

## Deployment and rollback plan (NOT EXECUTED)
1. Owner must approve the concrete `wrangler deploy --dry-run` request via signed NEXUS owner approval UI; ChatGPT must not simulate owner tap. If duplicate requests exist, select intended one and leave or explicitly reject others.
2. Inspect dry-run outputs and compare production deployment baseline/version, Wrangler bindings, routes, scripts, assets; no secrets in logs.
3. Obtain scoped authorization for production Gateway UI-only deployment, retain current Cloudflare Worker version for rollback, deploy using existing operator controls; do not touch Host/security/main.
4. Verify authenticated /live login & approval count, no authenticated secret exposed, POST /live/decide remains owner-only signed, /health 200, anonymous /mcp 401, cross-origin negative tests, Android browser real UI; rollback on abnormality.
5. Even after rollout, **chat-only repeats remain not actionable via /live**. An independent policy-design change to elevate repeats into owner-signed approvals is a separate, more significant security change and is not included here.
6. Shelley/pc-power-gateway hardware test remains blocked: phone guest Wi-Fi association and read-only SSH transport after switching not verified; no relay, OTA or WSS action in this work.

## Checkpoint
Staging code and tests only. Working NEXUS v0.6.1-next remains online, working Gateway/Cloudflare production unchanged.
