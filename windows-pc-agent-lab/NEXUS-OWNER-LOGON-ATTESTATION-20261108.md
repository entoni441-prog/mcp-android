# NEXUS — Owner-attested Chrome Remote Desktop pre-logon access

Checkpoint: 2026-11-08 (Europe/Rome)
Branch: `experiment/nexus-logon-attestation-20261108`
Disposition: **code implemented and regression-tested in an isolated experiment; NOT deployed to the active Host/Gateway; Windows NOT rebooted**.

## Confirmed preconditions (owner test, earlier in this conversation)
- Official signed Chrome Remote Desktop Host installed on Windows as `Antoni-ChatGPT`; `chromoting` is `Running / Auto / LocalSystem`.
- Owner connected from Samsung, controlled the screen, locked and unlocked Windows.
- Real `shutdown.exe /l` sign-out succeeded; NEXUS user-session tunnel went offline, independent CRD remained usable. Owner signed in from Samsung; NEXUS resumed automatically (connection_status online, changed Windows session ID 2→3).
- A FULL OS REBOOT **has not yet been performed**. The previous `power_action(restart,dryRun:true)` correctly returned blocker `logonChannelVerified:false`.

## Implementation
1. New `logon_attestation` Host/Gateway tool with exact actions `status`, `request`, `revoke`. Never accepts a password, PIN, user-provided flag, arbitrary executable or unverified channel.
2. `request` checks the actual Windows `chromoting` service must be `Running`, `Auto` and `LocalSystem`, plus an enabled `NEXUS-Host-Logon` task with a Logon trigger. Errors/missing services block attestation.
3. The request is classified `logon_channel_attestation` in `OWNER_WHATS` (NEVER auto-approved). It appears in the passphrase-protected owner approvals UI; `owner_decide` must carry the existing Gateway Ed25519 signature, timestamp and consentId. ChatGPT cannot self-authorize. After the owner approves, `confirm_action` rechecks the Windows service/task and only then atomically updates the protected capabilities profile, with an owner-evidence record (owner-tested full sign-out and remote sign-in, explicitly not an OS reboot test).
4. `logonChannelVerified` remains excluded from generic `set_capability`; owner can explicitly revoke attestation (fail-safe).
5. `power_action(restart)` still requires **ANOTHER, distinct owner-signed Live approval**. The newly verified `system_power` consent is included in `OWNER_WHATS`; former autonomous handling of power is no longer possible.
6. Immediately before Windows receives a consented restart, the Host atomically consumes the owner attestation and sets `logonChannelVerified:false`. If Windows rejects/cancels the request, another attestation is required; no automatic second restart is possible.
7. Restart dry run dynamically checks both the owner-attestation flag and current CRD service/task readiness; uninstall, stop, manual startup, non-SYSTEM service or lost NEXUS logon task fail closed. Separate independent wake path is still required for sleep/shutdown.

## Test evidence (real owner's Windows; isolated code clone)
- Host focused integration/regression: **61/61 PASS** after merging previous consent-visibility and iOS keyboard fixes.
- Gateway entire suite: **91/91 PASS**.
- Additional broad Host batch: **59/60 PASS**; the sole failure is an old, unrelated Live cursor fixture expecting (10,20) while the current Windows reports its actual cursor position (640,360). This is not a logon-attestation failure; not silently patched.
- New tests cover real HTTP MCP route, forged Ed25519 owner decision rejected even with the PC bearer token, authentic owner-signed decision accepted once, inability to self-approve by ChatGPT, service/task fail-closed, corrupted/missing prerequisites, persistence and revocation, two separate owner approvals, and single-use reboot flag.
- Gateway/Host catalog kept byte-identical, now **46** public tools; owner-only `owner_decide` is not in the public catalog.

## Source consolidation
This branch was created from `experiment/nexus-prelogin-reboot-access-20261108` and merged the later `experiment/nexus-ios-keyboard-safe-20261108` branch. That preserves the R-01 false-positive repair, approved-but-unconsumed consent visibility repair and safe iPhone keyboard UX changes.

## Do not deploy the repo snapshot blindly
The currently deployed Cloudflare Gateway is **LIVE v11**, but the previous local gateway source and some repo snapshots are older. A direct deploy could roll back the current interface or the remote access channel. The working Windows Host and deployed Gateway have NOT been replaced/restarted and `main`/production were NOT modified.

Release gate:
1. Obtain current deployed Cloudflare Worker bundle/version and independent rollback point; compare it with experiment.
2. Produce exact, reviewed patch atop the LIVE v11 code (Host + Gateway catalog/signing owner channel) in separate staging; do not overwrite the current Worker from an older checkout.
3. Perform security regression checks, staging tests and a genuine owner-signed test attestation. Obtain explicit production release approval before active Host/Gateway change.
4. In production: `logon_attestation({action:'request'})` → owner approves in Live → `confirm_action` → `power_action({action:'restart',dryRun:true})` → owner separately approves `power_action({action:'restart',dryRun:false})` → observe Windows reboot + CRD remote sign-in from Samsung + NEXUS recovery. Never auto-enter Windows PIN.
5. Only after verifying recovery can the post-reboot result be claimed PASS.

All signing keys/owner passphrase/PIN remain outside repository and model-visible channels.
