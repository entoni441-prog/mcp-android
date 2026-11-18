# NEXUS Gateway consent UI rollout — pre-deploy hash gate diagnosis
Date: 2026-11-18. Branch experiment/nexus-consent-channel-clarity-20261118. Source commit 967f808.

## Owner-approved original plan
- Signed owner approval received for plan f77041cdc5c3619d9321a10cca3259a62fb777052fd2971a5a4d7a78312c34ba, 3 steps: Wrangler dry-run, exact compiled SHA comparison, actual deploy.
- Step 0 Wrangler dry-run: EXIT 0, saved dist-consent-v11-release-20261118/index.js.
- Step 1 strict production catalog compiled SHA: EXIT 1. Plan state FAILED, next=1. Step 2 deployment NEVER EXECUTED.
- Immediately reconfirmed Cloudflare authoritative deployment b7fd9890-72b1-4d1c-94dc-3a63f07e5cdd, version 87d93ae5-ab8d-4926-8800-eb52a8e2364a, 100% active.

## Precise root cause
- Original comparison used byte-for-byte SHA of embedded // src/catalog.mjs section: production expected 543dd75c445c0984088ecda291d651a657dac8a2c6fa904b2150792c92b6f870.
- Fresh Wrangler 4.158.0 compilation formats added logon_attestation tool with double quotes and spaces, while active production v11 was uploaded via API and the same tool's section uses single quotes and denser whitespace.
- Local compiled catalog section 26673 bytes and SHA d7d9b160c8ee9087b5ec1f59b5d5e45e2328e78afb5a5693c3f578b0259c751b. Production section 26661 bytes.
- Split both production and candidate catalog modules into 46 tool stanzas; ALL 45 other tool stanzas' SHA-256 matched production exactly.
- The sole differing stanza was logon_attestation: local 812 bytes, production 800 bytes. After excluding only whitespace and quote characters, both 689-character normalized stanzas matched identically. The description, action enum status/request/revoke and destructiveHint:true were preserved.
- Local read-only postbuild gate checked compiled 46 tool count, v11 action enum, destructiveHint and pendingChatConsents UI marker, and pinned local artifact SHA; exit 0, CANDIDATE_VALID.
- Existing 52 Gateway tests PASS; normal Host/Gateway catalog parity PASS; no host runtime changes.

## Security decision
- Strict gate did its job: publishing did not occur without proof. A replacement one-step deploy MUST require a fresh signed owner approval because the earlier signed 3-step plan was single-use and already stopped; no reinterpretation or bypass.
- No changes in production, main, Shelly, or router at this checkpoint. Direct verified rollback target 87d93ae5-ab8d-4926-8800-eb52a8e2364a.
- After explicit new approval deploy once then verify Cloudflare active version, public health, unauthenticated MCP denial, session-protected approvals and NEXUS Host connectivity; rollback on material failure.

STATUS: ORIGINAL_PLAN_FAILED_SAFELY, STAGING_CANDIDATE_SEMANTIC_PARITY_PASS, NEW_OWNER_APPROVAL_REQUIRED.
