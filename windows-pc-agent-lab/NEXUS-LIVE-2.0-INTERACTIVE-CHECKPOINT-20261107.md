# NEXUS Live 2.0 — interactive overlay and owner touch (experimental checkpoint)

Date: 2026-11-07 Europe/Rome
Repository: entoni441-prog/mcp-android
Branch: `experiment/nexus-live-interactive-20261107`
Base: `fa7b0cd73876b9cb153e7ad7941a88561ed67b82` (existing v2 cache+owner approvals).
Last verified implementation commit: `5f874d8c74c2f46d2e5df291b4fb694a0defd1cb`.
Status: **EXPERIMENTAL CODE + CI PASS. NOT DEPLOYED. Real ChatGPT Android acceptance PENDING.**

## Owner requirement
Astra-like interaction directly on the Windows Live picture; alternatively a compact approval form that appears automatically over the Live widget and disappears after a decision. Touch, owner consent and phone keyboard must not grant privileges implicitly, must not send Windows credentials through the model, and must preserve STOP.

## Implemented in this branch
1. `nexus-gateway/src/widget.mjs`: popup owner approval overlay reuses the existing owner passphrase / signed Gateway decision system. It watches only `host_diagnostics.pendingConsents` (read-only count) every 8 seconds, offers manual panel fallback, and automatically hides after an authenticated decision. A closed popup is temporarily snoozed to prevent repeated nagging.
2. `src/widget.mjs`: opt-in `Управление: выкл./вкл.` toggle, **off by default**, single-owner tap via a fresh image (age < 5 s) + `mouse_action`. Coordinate mapping uses the actual rendered <img> rectangle and the frame's primary-screen geometry. Host still applies existing GUI allowlist/policy/consent checks. Untrusted, out-of-frame or stale events are ignored; no retry on uncertain results.
3. `src/widget.mjs`: explicit ordinary-text field and Enter/Tab/Backspace/Esc shortcuts via `keyboard_action`. No credential support; the widget warns against PIN, passwords, OTP, tokens, cards. It clears text after sending, retains unsent text if there is no fresh Live frame, and contains no browser storage for secrets.
4. Owner-approved GUI consent originating from this widget can be finalized only by matching the exact `consentId` and `target` through `confirm_action` **after** the owner has authorized via direct HTTPS to NEXUS Gateway. Unrelated pending actions are never replayed automatically.
5. Touch is disarmed on idle/STOP/remote stream-off or when the approval popup takes over. Popup does not remove or weaken STOP.
6. `nexus-gateway/src/widget-input.mjs`: deterministic frame-to-screen mapping with input validation and out-of-bounds rejection.
7. Both `nexus-gateway/src/catalog.mjs` and `nexus-host/catalog.mjs` now advertise `ui://nexus/live-view-v3.html` (byte-identical catalogs); gateway keeps v2 and v1 resources readable for compatibility, avoiding old ChatGPT widget cache.
8. Added `test/widget-input.test.mjs`, `test/widget-interactive.test.mjs`, and `.github/workflows/nexus-live-interactive-ci.yml`; upgraded legacy UI tests for the intentional change from view-only to opt-in input.

## Verification
- GitHub Actions [run 42352859291](https://github.com/entoni441-prog/mcp-android/actions/runs/42352859291) for implementation commit `5f874d8`:
  - **Windows-latest: PASS** — owner auth/integration regression, touch tests, catalog parity, Wrangler dry-run.
  - **Ubuntu-latest: PASS** — same checks.
- No production Gateway deployment, no installed Host replacement, no Windows security changes, no main branch writes.
- Previously delivered owner approval code and rollback procedures remain unchanged.

## Known limitations / production gates
- **No real ChatGPT Android click/keyboard acceptance yet.** Client mobile sandbox/modal/resize/pointer event behavior must be checked on a separately approved test rollout.
- The overlay is **inside the active Live iframe**. It does not create an OS push notification or global ChatGPT notification when the widget is closed.
- Watch-only frames cease after the NEXUS 45 s idle lease; sustained owner-operated remote desktop use needs a dedicated, audited owner control lease and concurrency arbitration between agent and phone user. Do not call this feature full Astra parity.
- Existing `mouse_action`/`keyboard_action` pass through the MCP Apps tool bridge and Host policies. **Never use this route for credentials.** A secure credential channel would require separate trusted transport / server-side protected-field checks and dedicated owner approval.
- Windows pre-login / post-reboot sign-in remains **unimplemented**. Do not enable `logonChannelVerified`; Windows Secure Desktop cannot be operated safely with current UIA/Host.
- The input experiment currently covers single clicks and simple ordinary text/keys, not drag, swipe, wheel, arbitrary gestures or protected Windows desktop.
- Approval query requires owner passphrase to view full pending targets and another fresh passphrase for each privileged decision; shared one-time nonce/lockout/Ed25519 signature protections remain in place.
- Before production: security review of owner-only input channel and agent/owner race, Android visual acceptance, real non-sensitive Notepad click/text test, STOP regression, rollback snapshot, separate owner authorization to deploy and install/refresh as required.

## Next checkpoint
Preserve this branch. Do not deploy or switch Windows Host from production until authorized. Continue with an isolated owner-control lease prototype, app-only input channel and Android acceptance plan; keep protected credentials and pre-logon separate.
