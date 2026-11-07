# NEXUS — ChatGPT Live owner approvals + pre-logon readiness checkpoint

Date: 2026-11-07, Europe/Rome.
Branch: `experiment/nexus-inline-owner-approvals-20261107`.
Status: **Experimental implementation accepted in unit/integration/CI. Not deployed to production. Windows remote pre-logon sign-in NOT implemented.**

## Owner's precise requirements
1. After reboot, ChatGPT Live must display reliable Windows availability, including pre-login status, and eventually provide a trusted, owner-only authentication field *inside the ChatGPT experience*, without making the owner walk to the PC.
2. **All NEXUS approvals currently performed at the external /live site** must instead be accessible via approval buttons inside the Live widget shown in this chat. Protected actions remain one-time and require explicit owner authorization.

## Windows facts confirmed read-only on actual owner PC
- Windows 11 **Pro** (build 26200), console session owner `krado`.
- RDP server currently **disabled** (`fDenyTSConnections=1`), Windows Network Level Authentication policy enabled, `TermService` Manual/Stopped, nothing listening on TCP 3389.
- No detected Tailscale/ZeroTier/WireGuard network adapters, no installed RustDesk/AnyDesk/Chrome Remote Desktop paths inspected.
- Existing NEXUS Host is launched in the user's interactive Windows session; that host cannot authenticate against Winlogon on a locked/never-logged-in secure desktop. Do **not** use fake key injection or Winlogon/credential-provider bypass.
- Existing `logonChannelVerified:false` blocks restart, as designed. Do not override it until independently verified full remote pre-logon recovery.

## Implemented: inline approvals (NX-CHAT-OWNER-01)
- New `windows-pc-agent-lab/nexus-gateway/src/widget-consent.mjs` with routes `/live/widget/challenge` and `/live/widget/perform` wired into `handlers.mjs` **only** in experimental branch.
- Direct HTTPS fetch from sandboxed ChatGPT MCP Apps widget to the *owned* Gateway. Strict origin matching `https://*.web-sandbox.oaiusercontent.com`, CORS allowlisted only for the Gateway, no cookies, no arbitrary external origins, no `tools/call` for owner auth.
- Widget contains expandable **«Подтверждения владельца»** panel, owner NEXUS passphrase field, list of pending Host approvals, explicit `Разрешить` / `Отклонить` / save/discard decisions. Reenter owner passphrase for **every** privileged request; never cache passwords in widgetState, storage, or transcript. The owner NEXUS passphrase goes only through direct HTTPS POST to NEXUS Gateway, consistent with existing /live authentication, not to any model/MCP tool. **Windows credentials/PIN are never requested**.
- Existing `CONSENT_GUARD` Durable Object enforces atomic one-time nonce, five-fail lockout, nonce expiry. Owner decisions continue to be signed by the **existing Gateway Ed25519 key** and verified on Host. No generic model-callable approval endpoint has been introduced.
- Web UI does not use innerHTML for approval text; arbitrary Host target text is inserted via `textContent`.
- The Live widget retains frame-only, STOP and native MCP bridge behavior; now also shows honest read-only `HOST_ONLINE` / `HOST_OFFLINE` based on Gateway's `connection_status`, **without mislabeling offline as login-required**. The booth/connection monitor and video frame polling have independent timers.
- Gateway new CSP `connectDomains` includes **only** `https://nexus-gateway.entoni441.workers.dev`; no frameDomains, no Windows credentials. Production Worker was not touched.

## Verified evidence
- On actual owner's Windows machine: Gateway suite (handlers, offline, live, owner061, guard-core, widget-owner, widget-owner-route): **44/44 PASS** exit 0.
- Negative tests: bad Origin, missing widget header, malformed decisions/ID, wrong passphrase, 5-fail lockout, nonce replay, cross-Origin replay, no owner_decide before authorization, no secret forwarded to Host, one-time signed decision.
- Independent GitHub Actions: run **42345562253** on Windows-latest and Ubuntu-latest: **both PASS**.
- Independent GitHub Actions run **42345728235** on Windows-latest and Ubuntu-latest: **both PASS**, including `wrangler deploy --dry-run` production-shaped bundle. This is a *dry run*, nothing deployed.
- Final hardened run **42346090018**: Windows-latest and Ubuntu-latest both **PASS** (unit/integration, security regression, and Wrangler dry-run).
- CI added under `.github/workflows/nexus-inline-owner-ci.yml` for this branch only; code syntax and component tests checked.

## Remaining gates / limitations
1. *Real ChatGPT Android acceptance pending:* Widget CSP, sandbox origin and mobile callbacks must be verified on actual ChatGPT client after an explicitly approved test rollout. Do not call unit-test PASS a real-world UI acceptance.
2. *Production Gateway not updated:* rolling out only the experimental Gateway (no Host change needed for owner approvals) requires explicit owner approval, rollback version backup, dry-run+monitoring and never publishing to main by default.
3. *Windows pre-logon remote access still blocked:* RDP server is disabled, private network channel absent, no independently trusted web-RDP broker or pre-login service. Plain Live iframe cannot record Winlogon, enter PIN, or guarantee stream when user has not logged on.
4. Recommended secure path for next separate experiment: authenticated **private transport** (never public TCP 3389) → Windows supported RDP+NLA via owner-operated trusted web client or equivalent audited unattended desktop service launched before login, **owner-only** credential view outside model/tool parameters → reconnect NEXUS/boot service → signed boot-session status. Requires separate Windows security/production authorization.
5. A conventional Windows Hello **PIN is not equivalent to a reusable RDP password**. Remote login flow must be verified with the actual supported Windows authentication path, and owner secrets never logged or forwarded to the model.
6. **Do not set** `logonChannelVerified=true` until actual cold/reboot remote login test PASS, with safe recovery fallback and explicit owner consent.
7. Other known defect `power_action({action:'lock',dryRun:true})` executes lock; track separately, not part of this patch.

## Suggested signed remote boot/status contract (next milestone; NOT implemented)
Pre-login provider must run independently from user session and emit only signed fresh statuses: `BOOTING`, `LOGIN_REQUIRED`, `OWNER_AUTHENTICATING`, `DESKTOP_READY`, `HOST_ONLINE`, `ERROR`. Include boot ID, nonce/sequence, timestamp and expiry; verify signature, monotonic sequencing, owner authentication, heartbeat and timeout. Never derive `LOGIN_REQUIRED` from Host unreachable alone. The browser owner's sign-in field must be isolated from ChatGPT model/tool bridge, passwords and plaintext recordings.

## Stop point
Experimental branch code can be reviewed and iterated without touching production. The owner should not enter a Windows password or PIN into current ChatGPT widgets. Additional production/security changes await explicit authorization.

## Security hardening after initial acceptance
- A public cross-origin widget challenge endpoint could otherwise fill the common pending nonce queue and evict legitimate OAuth / owner Live requests. Fixed by separate Durable Object storage buckets: default `pending` retains OAuth/Live nonces, `widget_pending` contains widget challenges. Both share the **same** owner passphrase failure counter and lockout.
- `GuardCore.issueWidget` / `attemptWidget` and `ConsentGuard` RPC methods are dedicated to the embedded widget; no new model-callable owner-approval tool.
- New regression proves 30 widget challenge requests do not evict a previously issued OAuth nonce or external Live nonce, and a nonce from one bucket cannot be redeemed via the other.
- The Live display timer and the boot connection-status timer were separated, so the normal 2fps frame refresh does not cancel the 15-second status check.
- Last verified hardened GitHub Actions run: **42346090018** (Windows + Ubuntu PASS). Actual mobile ChatGPT acceptance still required before any production deployment.
