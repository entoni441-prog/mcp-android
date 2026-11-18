# NEXUS Consent UI production preflight baseline — 18 Nov 2026

Authorized scope: owner requested release of ONLY consent-channel UI clarity in current Cloudflare Gateway, preserving security and all existing catalog tools. No Host runtime, Windows policy, main, Shelly or router changes.
Staging branch: experiment/nexus-consent-channel-clarity-20261118. Previous tested checkpoint 7fedf16.

## Authoritative Cloudflare baseline
- Account: Entoni441@gmail.com's Account (Cloudflare API read-only). Script: nexus-gateway.
- Active deployment at preflight 2026-11-18: b7fd9890-72b1-4d1c-94dc-3a63f07e5cdd.
- Active version for rollback: 87d93ae5-ab8d-4926-8800-eb52a8e2364a at 100% traffic, created 2026-11-08T20:15:40Z.
- Binding configuration: CONSENT_GUARD Durable Object, OAUTH_KV KV, NEXUS_TOKEN secret_text, OWNER_PASSPHRASE_SHA256 secret_text. Compatibility date 2026-10-01 with nodejs_compat. Neither secret value accessed.
- Cloudflare deployed script bundle compared by module hashes with previously dry-run staging bundle: source sections differ only at catalog.mjs (new v11 logon_attestation) and live-page.mjs (our intended UI change); widget.mjs and handlers.mjs sections match exactly.
- The remote deployed catalog has 46 tools and includes the logon_attestation tool. Older staging branch catalog had 45. Before deploy the exact production v11 schema and description were restored to staging Gateway AND staging Host catalog (source parity only, no live Host modification).

## Revalidated candidate
- Scoped changes from checkpoint: production v11 catalog parity in both staging source copies, test expected 46 tools and preserved logon_attestation enum status/request/revoke with destructiveHint true.
- Gateway tests: 52/52 PASS, exit 0, including owner signed approvals and live UI tests, catalog parity, anti-replay and OAuth.
- node --check for gateway catalog.mjs, live-page.mjs, host catalog.mjs: all exit 0.
- Current running NEXUS Host 0.6.1-next online, tunnel healthy, no changes.

## Release gate & rollback
- Release only through Wrangler, in already configured authorized account, with NEXUS owner signed consent when requested.
- Recheck Wrangler dry-run AFTER restoring v11 catalog and verify compiled catalog matches authoritative production baseline.
- Before publishing check that Cloudflare active deployment remains b7fd9890-72b1-4d1c-94dc-3a63f07e5cdd (or stop to reconcile).
- Deploy once, record new worker version and deployment; verify /health 200; anonymous /mcp 401; session-gated /live/consents; unauthorized public origins denied. Check owner screen manually if required; no use of owner credentials in model/tool parameters.
- If regression: rollback to version 87d93ae5-ab8d-4926-8800-eb52a8e2364a 100% through Cloudflare deployment API. No speculative retry.
- If owner phone approval is required, hold until owner confirms through signed /live interface. Chat consent alone does not sign the privileged operation.

## Status
STAGING VALIDATED, PRODUCTION NOT MODIFIED at writing time.
