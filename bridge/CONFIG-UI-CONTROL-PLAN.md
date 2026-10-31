# Antigravity configuration and UI-control extension — experimental

## Product goal
ChatGPT can configure Antigravity itself, not merely send model prompts. User expects both configuration outcomes and true graphical operations (buttons, menus, toggles) where supported.

## Grounded platform boundary (official Google Antigravity documentation, checked 2026-10-31)
- CLI settings are saved in `~/.gemini/antigravity-cli/settings.json`; GUI `/config` changes this file. It supports documented JSON schema and non-default keys.
- Remote Control web client **cannot toggle CLI settings**; it only controls conversations and approvals. The reliable route for CLI settings is file management or CLI commands *on the actual host*, not clicking the web Remote Control.
- Antigravity App/IDE, the CLI and Remote Control are distinct surfaces. Don't assume adjusting CLI JSON changes App/IDE global/project UI settings.
- True GUI clicks need an actual authenticated browser/desktop control capability. The current ChatGPT bridge is only an authenticated D1 queue with fixed read-only probe, **not** a browser/screenshot controller. ChatGPT Work Cloud Browser can be tested separately in Work mode where it is available and after the user signs in. Don't expose debug ports or session cookies.

Sources: https://antigravity.google/docs/settings?tab=cli
https://antigravity.google/docs/remote-control?tab=cli

## Stage A — local config control (current state: PROTOTYPE ONLY)
`bridge/config_control.py` offers:
- `inspect`: returns a redacted allowlist of harmless preferences and the configuration digest. Unknown keys and secrets are never returned.
- `plan <key> <value>`: shows a dry-run change, no mutation.
- `apply <key> <value> --expected-sha256 <hash>`: strict allowlist, optimistic concurrency, lock, private backup and atomic JSON replace, then read-back.
- Requires the already verified *test Codespace* branch. No production paths, permission loosening, model or billing changes allowed.

The initial allowlist deliberately covers cosmetics only: verbosity, colorScheme, altScreenMode, runningLightSpeed. Tool permissions, agentMode, sandbox, non-workspace access, plugins, hooks, secrets, account and integrations are blocked. Changing these will need distinct code reviews, security gates and explicit authorization.

**Not yet verified in the user's Codespace**. No configuration has been inspected or changed. The v0.2 Worker still accepts only `probe` jobs and the installed background agent is unchanged. Don't claim this tool is accessible over Bridge until the signed protocol is extended and tested.

## Stage B — remote configuration protocol (NEXT)
1. Implement bounded `config.inspect` job type with signed Ed25519 agent claim/finish; respond only allowlisted metadata.
2. Verify data redaction, stale-plan refusal, and terminal/CLI flag override behavior in the same test Codespace.
3. For `config.plan` and `config.apply`, require exact key/value allowlists, an expected digest and a confirmed approval policy for noncosmetic settings.
4. Log what changed, test CLI reload, and preserve rollback capability.
5. Add safety policy separating experimental Codespace from Chat Router / CONSILIUM / TRINITY workspaces.

## Stage C — graphical control (separate)
- Prefer existing ChatGPT Work browser computer-use where it can access the relevant Antigravity web UI or authenticated GitHub Codespaces UI.
- Test concrete actions: opening settings, reading visible state, clicking safe toggles, verifying state. Browser sign-in is user-driven; never collect passwords or 2FA codes.
- On current Remote Control web client, do not promise that CLI settings toggles are available: Google docs explicitly say they are not. In that case config-controller performs the equivalent setting change on the host, then verifies against CLI.
- For any native desktop-only control, require an actual desktop control channel; the existing Codespace does not provide a visible Antigravity native desktop by itself.
- Keep a distinct allowlist for UI actions and require human approval for changing billing, permissions, sharing, security, deploy, or credentials.

## Invariants
No user secrets in Git, D1, logs or chat. Do not loosen permission presets to force GUI control. No remote shell exposure. No automatic bypass of Codespaces idle timeout or usage limits. Existing v0.2 Bridge and Remote Control must remain running and unaffected.

## Implementation checkpoint — v0.3 read-only inspect

- Added isolated D1 table `config_jobs` with queued/running/success/error states and agent-specific lease; existing proven `jobs` table is **unchanged**.
- Uploaded `agy-bridge-mvp` Worker v0.3 (PUT accepted 200), preserving signed Ed25519 auth for all agent endpoints. Added authenticated claim/finish routes exclusively for `config.inspect`. Incoming reports are strictly schema validated on the Worker, then filtered down to four allowlisted preferences and SHA-256 digest. No public job submission endpoint.
- Extended `bridge/agent.py` to request only fixed `probe` and `config.inspect` job types; the config command runs a fixed local `config_control.py inspect` subprocess without GitHub or OAuth secrets in environment.
- Hardened `config_control.py inspect`: unsupported or unexpected values always become `null`; no raw JSON or account details returned. No settings changes, tools, or UI automation triggered.
- Copied the new agent and inspector to the existing *experimental Codespace branch* `experiment/agy-codespaces-autostart-20261030`; neither `main` nor `.devcontainer/devcontainer.json` were changed.
- Cloudflare settings check: D1 binding present, `config_jobs` exists and was initially empty; old test jobs remain. New agent changes are NOT live inside `haunted-shadow` until that Codespace pulls its branch.
- Before claiming live success: check existing `BRIDGE_OK` probe after Worker deploy; synchronize test Codespace via `git pull --ff-only`; submit precisely one `config.inspect` and verify D1 result contains only allowed settings. If the Codespace auto-stopped, restart manually (no idle-timeout override).
- Future: `config.plan` and `config.apply` only with explicit per-setting authorization, CAS digest, backup and readback; real graphical UI control still separate and unproven.


## Security review + UI feasibility checkpoint — 2026-10-31

### Code and tests
- Previously verified in **real test Codespace**: local \`plan verbosity low\`, \`apply\` with matching SHA-256 and exact byte-for-byte \`rollback\`; settings restored to the original SHA. This was local execution, not a remotely queued mutation.
- Isolated v0.4 Worker retains signed Ed25519 agent endpoints. **Dynamic V8 policy test: 14/14 PASS** for approval required on writes, expiry, allowed keys/values, digest validation and result redaction. Checked against the current GitHub Worker source, without changing Cloudflare.
- Added reproducible \`bridge/tests/test_worker_config.mjs\` (14 hermetic Node tests) and \`bridge/tests/test_config_control.py\` (9 hermetic Python tests). Node policy rules were executed in the tool's JS runtime; **the checked-in Node/Python test files themselves have not yet been run in Codespaces/CI**.
- Hardened local rollback for interruption after recording the private journal but before updating settings: if the file still has its original SHA, rollback now closes the pending journal without overwriting the already-correct settings. Source change also mirrored to the test Codespace GitHub branch, but **not yet pulled into the live Codespace**. No current user settings were changed by this update.
- Read-only D1 verification: one completed inspect, one superseded failed plan, only one approved agent, enrollment closed. No remotely queued apply or rollback.

### Existing Cloudflare tool limit
- One earlier Cloudflare connector attempt to insert a new \`config.plan\` job was explicitly blocked by a safety layer. Do not retry the same mutation through another endpoint, script, proxy, GitHub Action, or credentials. The local plan/apply/rollback proved file operations but **did not remove this remote execution boundary**.
- Therefore do not call the full remote control protocol proven, nor silently enable remote mutations.

### Graphical/UI control separation
Official Google docs reviewed:
- https://antigravity.google/docs/commands/browser/
- https://antigravity.google/docs/settings
- https://antigravity.google/docs/remote-control

The Antigravity \`/browser\` command can drive Chrome pages (click, fill, snapshot, screenshots, console) when browser subagent and Chrome DevTools are available. This is browser automation *inside an Antigravity session*, not a guarantee of controlling Antigravity's **own** CLI configuration overlay or native App/IDE chrome.
- Remote Control web app is an authenticated conversation/approval surface. It is **not** assumed to expose all CLI settings controls. Actual CLI preferences remain configured via documented settings.json or interactive /config.
- To operate visible GUI buttons, supply a browser/computer-use session connected to the actual UI. This chat currently has GitHub/Cloudflare connectors but **no direct browser/computer-use action**; do not invent clicks, screenshots, or UI change confirmations.
- Work mode's Cloud Browser can be used for a first **read-only UI pilot** after user-authorized sign-in, checking which Antigravity settings pages are actually exposed. Do not export session cookies, create unauthenticated remote debugging endpoints, loosen account/agent permissions or change billing.

### Exact first UI pilot once browser control is available
1. Open the user's already authorized Antigravity Remote Control dashboard; inspect current instance list and selected test instance only.
2. Open available Settings/Preferences pages and record exact controls that are visible, including each current value. Do not change any setting.
3. Build a surface-by-surface capability inventory: browser UI, CLI persisted settings, native App/IDE-only settings.
4. Perform a single reversible **cosmetic** UI change only if a real control exists and the user has approved that setting category; read back the visible state and revert. Never click unknown approval prompts or permission-escalation options.
5. Only after read/write/revert verification extend Bridge with explicitly scoped UI actions and user-visible audit.

### Invariants and next checkpoint
- No production/main changes, no Codespace rebuild, no new billed infrastructure.
- Keep existing fixed-probe and read-only inspect operational.
- Keep GUI buttons and remote configuration mutations labeled **unverified** until an actual authenticated end-to-end test succeeds.
