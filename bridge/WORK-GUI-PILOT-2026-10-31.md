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
| Continued through the secure account form and selected “Try another way” | Google displayed its sign-in method chooser. Options included password, passkey and “Try another way”. |
| Selected the alternate route in the chooser | Google opened Account recovery and requested a previously used password. Returned to the normal sign-in page without submitting recovery information. Authentication remains pending. |

The click and navigation are verified. The welcome screen did not expose Settings/Preferences, instances, approvals, model selection or permissions. Availability of these controls inside the signed-in app remains unknown. No cosmetic setting was changed or reverted. Next verification starts after Google sign-in: identify the test instance if visible, inventory the controls, then change and restore one cosmetic preference only if available.

## Authenticated GUI pilot — 2026-10-31

Google sign-in succeeded. Work observed the Remote Control Instances page and clicked **Refresh instances**. The button became disabled, the list displayed a loading indicator, then the button re-enabled with a newer update time. All six rows still showed Offline.

| Instance | Evidence linking it to haunted-shadow |
| --- | --- |
| codespaces-d015bd-turbo-drift | Test launcher start, recorded in the autostart branch checkpoint. |
| codespaces-d015bd-roving-zenith | Same test Codespace after stop/start, previously observed Online. |
| codespaces-d015bd-mighty-void | Shared prefix only. Unverified. |
| codespaces-d015bd-swift-shard | Shared prefix only. Unverified. |
| codespaces-d015bd-vivid-ion | Most recently opened, same prefix. Current assignment unverified. |
| codespaces-5e31df-golden-meteor | Outside test scope. |

The offline list exposed refresh, remove actions, Google Account and feedback. No instance start, settings, cosmetic preference or model selector was visible on that screen. No instance was removed and no preference or model was changed. A read-only aggregate of the isolated bridge's approved-agent request records showed the last signed request was 1,256 seconds old. A sleeping Codespace is plausible, but the website does not distinguish host suspension from a stopped process or connectivity failure. Opening GitHub Codespaces in Work led to GitHub sign-in. Next: inspect the exact test host's state and resume it if stopped, refresh Antigravity, then correlate the online row before inspecting session controls.

### Codespaces access and stopping point

After Google device confirmation, GitHub displayed **Device verification** and reported sending a verification code by email. Work's secure form request timed out without a submission result. The user saw “Данные для входа не были доставлены”. A subsequent read-only browser state check also timed out. The last verified GitHub screen was the device challenge. There is no evidence of an incorrect code, failed email delivery, a GitHub rejection, or which component caused the timeout. GitHub authorization was not retried after the user's stop instruction.

Repository reads and report writes work through the GitHub connector. Its exposed operations do not include listing, starting or inspecting Codespaces. Current VM state and the cause of Offline remain unverified. The authenticated Antigravity list refresh is confirmed. Session menus, model selection and changing/restoring a cosmetic preference still require an identifiable online test instance. The next independent GUI observation, once one is available, is to open that instance and inspect its controls. No session preference requires rollback.

### Manual resume of haunted-shadow — 2026-10-31

The operator reported starting haunted-shadow and opening VS Code. A read-only query on the isolated bridge found the approved test agent's latest signed request at 10:02:33 UTC (13 seconds before the query). This confirms recent bridge activity after the reported resume. It does not identify the current Remote Control instance or establish its Online state.

Binding to the existing authenticated Antigravity tab timed out after 300 seconds. Resetting the browser-control runtime also timed out after 300 seconds. No new instance list was obtained and Refresh was not clicked in this run. The earlier six Offline rows predate the manual resume. No current instance, menu, model selector or reversible cosmetic change was verified. Resume at the Antigravity instance list once browser control responds. No GitHub sign-in attempt or Codespace operation was performed.

### STOP — browser control unavailable (2026-10-31)

Applied [ASTRA-STOP-RULES.md](ASTRA-STOP-RULES.md) at checkpoint `cb4c84f`. The operator started haunted-shadow and the approved Bridge agent sent a signed request at 10:02:33 UTC. The last GUI list predates that start.

- **Blocked operation:** binding the existing Antigravity tab (`getTab`) and the single recovery diagnostic (`js_reset`) each returned `timed out awaiting tools/call after 300s`. No fresh UI state was returned. The underlying cause is unknown.
- **Independent diagnostic availability:** the current tool inventory exposes no separate Work browser-runtime health or log endpoint. The repository and Bridge cannot diagnose this timeout. No new browser, sign-in or agent checks were issued.
- **Recovery prerequisite:** restored Work browser control, demonstrated by a successful read of the authenticated Antigravity tab in a repaired or replacement Work session. No account or Codespace action is requested from the operator.
- **Resume:** only after that recovery, refresh the instance list once and correlate an online row with haunted-shadow before opening it. Until then, current GUI status, model selection and cosmetic preferences remain unverified.
- **Safe state:** only this experimental report was updated. No changes to main, production, working Codespaces, security or billing. No cosmetic change awaits rollback.
