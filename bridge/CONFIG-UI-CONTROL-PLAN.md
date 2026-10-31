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
