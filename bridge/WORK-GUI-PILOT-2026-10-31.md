# Antigravity UI-control pilot — Work handoff (2026-10-31)

## Purpose
Verify whether ChatGPT Work's authenticated Cloud Browser can independently operate real visible Antigravity UI controls (menus, buttons, setting toggles), rather than merely changing CLI config files. User explicitly requested independent UI configuration and approved continuing this pilot.

## Established checkpoint — DO NOT redo
- Separate test Codespace: `haunted-shadow`, branch `experiment/agy-codespaces-autostart-20261030`, repo `entoni441-prog/mcp-android`.
- Signed Cloudflare Bridge `agy-bridge-mvp` v0.4, one approved agent, closed enrollment. Probe `BRIDGE_OK` and unattended recovery after Codespace stop/start confirmed.
- Remote `config.inspect` confirmed; local `plan/apply/rollback` of `verbosity` on **test** Codespace confirmed, exact original settings restored (SHA-256 `f99423432ba6528ee62cbff006e620984be606ba0a6cd0f1d8fc81b0582a1f29`).
- Full signed remote `config.plan/apply/rollback` **NOT VERIFIED**; a Cloudflare connector queue mutation was blocked by the platform safety layer. Do **NOT** circumvent that block.
- No GUI click/setting control previously tested in this chat.
- Config control plans: `bridge/CONFIG-UI-CONTROL-PLAN.md` in this branch.
- Live CLI host configuration and Antigravity's own app/IDE UI are not interchangeable; do not conflate.

## Work mode instructions
1. Use Cloud Browser only if the Work environment actually exposes computer/browser interactions in this session. Confirm availability instead of inferring it from product name.
2. Open the official Antigravity Remote Control site `https://antigravity.google.com` (use the actual official Remote Control URL when directed) in browser. If GitHub Codespaces site is needed, open `https://github.com/codespaces` and identify **test** `haunted-shadow` only. Do not touch original working Codespace.
3. User may perform Google/GitHub authorization or 2FA inside the browser. Never request or disclose passwords, cookies, access tokens, or authentication codes.
4. Inspect actual visible UI controls, especially Settings/Preferences, instance selector, approvals, model selection and permissions. Document controls that exist vs controls not available in this interface. Capture only non-sensitive evidence.
5. If a purely cosmetic, reversible UI preference exists, test exactly one user-approved non-security choice and revert it. Verify visible readback. If no such control exists, do not invent UI automation or click unrelated controls.
6. Do not change account, sharing, security, permissions, billing, agent mode, model quotas, production deployments, main branch, or idle timeouts. Do not rebuild any Codespace, install remote desktops, expose debugging ports, or attempt unsupported native IDE GUI automation.
7. Report outcome with screenshots or a precise visibility/action record. Distinguish read-only inventory from working clicks, and from CLI config-file edits. Make no unverified success claims.
8. Update this checkpoint in experimental branch only after observed results.

## Gate before Work pilot
No direct Cloud Browser or computer-use tool is exposed to the ordinary chat session that authored this handoff. Actual UI operations must be performed in a Work session with computer-use enabled; do not promise they have happened otherwise.

## Work GUI observation — 2026-10-31

| Action | Visible result |
| --- | --- |
| Opened the official Antigravity site in Work Cloud Browser | The welcome screen showed “Welcome to Antigravity” and a “Sign in” button. |
| Clicked “Sign in” | Google Accounts opened with “Use your Google Account”, an “Email or phone” field and a “Next” button. |
| Continued through the secure account form and selected “Try another way” | Google displayed its sign-in method chooser. Authentication is pending at this checkpoint. |

The click and navigation are verified. The welcome screen did not expose Settings/Preferences, instances, approvals, model selection or permissions. Availability of these controls inside the signed-in app remains unknown. No cosmetic setting was changed or reverted. Next verification starts after Google sign-in: identify the test instance if visible, inventory the controls, then change and restore one cosmetic preference only if available.
