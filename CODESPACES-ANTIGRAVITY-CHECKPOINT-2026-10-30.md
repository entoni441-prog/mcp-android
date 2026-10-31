# Checkpoint: Antigravity CLI via GitHub Codespaces — 2026-10-30

## Confirmed in actual Codespace (user screenshots)
- GitHub account: entoni441-prog.
- Current Codespace created from `entoni441-prog/mcp-android`, branch `main`, West Europe, 2-core Linux x86_64.
- The repository is clean (read-only check succeeded).
- Antigravity CLI v1.4.11 installed at `/home/codespace/.local/bin/agy`.
- Interactive CLI authentication succeeded; remote control session activated with `/remote-control`.
- The Google Antigravity remote control website showed instance online and opened a working conversation from Samsung.
- Antigravity accessed `/workspaces/mcp-android` and returned the working directory, repository, branch and root file listing without changes.
- Native `agy remote-control start` requires systemd; systemd not running in this Codespace.
- `tmux` not installed (command -v tmux returned exit 1).

## State of the autostart experiment
- Separate Git branch `experiment/agy-codespaces-autostart-20261030` includes `.devcontainer/devcontainer.json` and `.devcontainer/agy-remote.py`.
- This autostart experiment is **not yet tested** in the actual Codespace; it must not be described as working.
- Do not merge into `main` or rebuild the existing working Codespace before testing in a separate disposable Codespace.
- No changes were made to Android source code or Cloudflare infrastructure.

## Preservation and recovery — no secrets
- GitHub documents that **ordinary stop/start preserves files in the same container**, including files in the user home directory. The Antigravity installation and locally saved login are therefore expected to survive a normal stop/start, but the login should be verified after resuming.
- A **container rebuild** discards modifications outside `/workspaces` (including `~/.local/bin/agy` and local authentication), so avoid Rebuild / Full Rebuild on this working Codespace.
- Stop/start preserves saved workspace files, but stops running CLI processes. Remote Control needs to be restarted manually until the autostart experiment is proven.
- In VS Code after restarting: run `agy` (if the shell PATH is correct), then enter `/remote-control` in the interactive CLI. If `agy` is missing from PATH, use `~/.local/bin/agy`.
- Access the active instance through `https://antigravity.google.com/`. Never place OAuth codes, tokens, or local credential folders in GitHub or in this checkpoint.
- GitHub Codespaces stops at inactivity timeout; stopped Codespaces consume storage quota but not CPU quota. Source repository files in GitHub are separate from live Codespace lifecycle.
- GitHub Codespaces may delete old idle environments under its retention policy; keep nonsecret configuration and committed code in GitHub.
- Do not start another Codespace just to preserve the existing one.

## Next safe verification
1. Verify ordinary stop/start restores the installed CLI and authentication; do not rebuild. This step requires interaction with the Codespaces UI (not exposed by the currently available GitHub connector).
2. Separately test `experiment/agy-codespaces-autostart-20261030` in an isolated Codespace without risking the working instance.
3. If that succeeds, evaluate automated autostart without disabling the default idle timeout.

## Known GitHub limitation
The ChatGPT GitHub connector can read/write repository files and branches, but cannot access Codespaces VM processes, user home directories or authentication files. This document preserves the technical checkpoint; it is **not a full image or backup of the running container**.

## Offline preflight on 2026-10-30
- Reviewed `.devcontainer/devcontainer.json` and runner against current GitHub Codespaces documentation. GitHub falls back to its default Linux image if the devcontainer config does not specify an image.
- Independently validated the runner's Python syntax in a disposable Linux environment.
- Executed a mock `agy --remote-control` binary under the runner: `start`, `status`, capture of console output, and `stop` succeeded.
- This test **does not** confirm real Antigravity Remote Control in an actual fresh Codespace, survival across stop/start, nor availability of credentials there.
- Next: create a **separate** Codespace from this experiment branch; never rebuild the already-working `main` Codespace for this test.

## VERIFIED — actual Codespaces stop/start, 2026-10-31 (Europe/Rome)

- **Test Codespace:** `haunted-shadow`, repository `entoni441-prog/mcp-android`, branch `experiment/agy-codespaces-autostart-20261030`. Existing `main` Codespace left unchanged.
- Initial creation: `postStartCommand` was present, but `agy` was missing; runner reported `runner not running`. The script's graceful skip when CLI is absent worked as designed. **Fresh Codespace is NOT yet zero-touch.**
- Installed official Antigravity CLI **1.4.12** manually within the test Codespace and completed one-time Google OAuth interactively. No tokens or OAuth codes committed.
- Manually invoked `python3 .devcontainer/agy-remote.py start` and confirmed the process was alive; Antigravity Remote Control appeared **Online** as `codespaces-d015bd-turbo-drift`. Remote Control web UI connected successfully.
- Stopped the test Codespace from GitHub Codespaces UI (GitHub displayed confirmation). Reopened it in the browser, thereby restarting the same Codespace; **no manual runner or CLI command was run after restart**.
- On https://antigravity.google.com/, new instance `codespaces-d015bd-roving-zenith` appeared **Online**, old `turbo-drift` was Offline. Connected to `roving-zenith` and reached the interactive Remote Control UI. A browser-side **Security Notice & Data Use** acceptance was requested on reconnection; accepted with optional usage-data checkbox clear. Final interactive UI displayed ready state.
- **Conclusion:** `postStartCommand` + PTY runner restores Antigravity Remote Control automatically across a real stop/start of the *already-installed and authenticated* Codespace, without `systemd` or `tmux`. This is verified by user screenshots, not an API-side VM inspection.
- **Remaining limitation:** Creating a completely fresh Codespace still requires CLI installation and one-time OAuth. Automatic CLI install is not implemented; do not confuse recovery of existing Codespace with initial provisioning. Codespaces auto-stop still applies, and GitHub compute/storage quota remains enforced.
- **Next phase:** Before expanding to a ChatGPT-Antigravity MCP bridge, decide whether automated CLI provisioning of new Codespaces is necessary. Keep `main` unchanged and avoid storing Google credentials in Git.

## Bridge background autostart checkpoint — 2026-10-31 (activation not yet verified)

- One-shot signed task already completed successfully in D1 with result BRIDGE_OK; agent fingerprint 8fce8450fc2aa472 is approved, enrollment remains closed.
- Existing devcontainer.json remains identical. The already verified postStartCommand continues to call .devcontainer/agy-remote.py start.
- Experimental agy-remote.py now invokes a separate optional Bridge supervisor after its existing Remote Control start. This preserves the old Remote Control behavior and avoids rebuild / reauthentication. Commit af586ee8aeb291df4d2e1498163566c29144069d.
- Proven agent.py source copied unchanged to this test branch. No keys or tokens committed.
- Standalone supervisor implementation checked into Bridge-development branch experiment/agy-bridge-mcp-20261031 at immutable commit 570a82a8dfa6dce348a59a919d0b0096047548b9.
- Local offline integration test: duplicate start prevented, repeated mock polling successful, status accurate, clean stop. Supervisor checks correct test branch, approved Ed25519 key fingerprint, CLI and curl. It filters inherited environment to avoid forwarding Codespaces/GitHub tokens.
- Live activation still requires syncing the test branch in the existing test Codespace, copying the pinned supervisor into its persistent workspace, and starting the optional hook once. No direct Codespace shell-execution tool is available in this session.
- Must verify one queued probe completes WITHOUT a manual agent invocation and then test stop/start. Do not claim verified before these observations.
- Cost controls unchanged: background poll never writes terminal output or tries to defeat GitHub Codespaces idle timeout. Stopped Codespaces cannot run tasks or wake themselves.

### One-command activation installer (additional checkpoint, 2026-10-31)
- Added bridge/install.py in the test branch (commit 78276c4563d9b9e1da8b0981d908443be80e283b).
- Installer checks current test branch; fetches supervisor from separate experiment branch at pinned commit 570a82a8dfa6dce348a59a919d0b0096047548b9; validates exact Git blob SHA 8699bb514092d9fea230a0f752a2affc42a4c867, compiles it and refuses conflicting local-file replacement.
- Installer invokes existing .devcontainer/agy-remote.py start and checks background supervisor status. There is no devcontainer config change, no rebuild, no Google reauthorization, no secret export, no main or Cloudflare production changes.
- Activation command on already existing TEST Codespace: git pull --ff-only origin experiment/agy-codespaces-autostart-20261030 && python3 bridge/install.py
- **Still pending:** first run of this installer in the actual Codespace, probe processed without any manual CLI run, and Codespace stop/start recovery test. Offline mock tests do not imply runtime success.

## CONFIRMED: unattended Bridge polling, 2026-10-31 08:37 Europe/Rome

- User ran only initial activation in test Codespace haunted-shadow: git pull --ff-only origin experiment/agy-codespaces-autostart-20261030 && python3 bridge/install.py. Terminal confirmed 'Verified supervisor source installed (no credentials copied)', 'Bridge poller started', and 'Antigravity Remote Control runner is already active'. Supervisor status showed 'Bridge poller: running'.
- VS Code showed an optional container rebuild prompt. No rebuild performed or required. devcontainer.json unchanged; original Remote Control remained running.
- ChatGPT inserted **one** test job (probe-20261031-background-autopoll-01) into the isolated D1 queue, at Unix time 1793432263. NO manual agent command was given.
- Cloudflare D1 independently confirmed the already approved Ed25519 agent 8fce8450fc2aa472 autonomously CLAIMED the job at 1793432268 (5 seconds after queueing). Status progressed queued -> running.
- D1 independently confirmed completion at 1793432273: status=success, response=BRIDGE_OK, error empty, lease cleared. End-to-end unattended processing proved.
- Existing main, production, Codespaces billing/idle timer, and unrelated Cloudflare Workers/D1 remained unchanged. Enrollment still closed and first prototype only processes fixed harmless probes.
- **Not yet verified:** stop/restart of test Codespace and corresponding auto-resume of the Bridge poller; Remote Control auto-resume was separately verified previously. Agent runs while Codespace is active; it cannot wake a stopped Codespace or keep one alive beyond provider limits.
- Next step: stop test Codespace haunted-shadow from GitHub UI, start it again normally without terminal commands, then ChatGPT queues a fresh fixed probe and verifies unattended completion. Do not rebuild the container or operate on golden-meteor.

## CONFIRMED: Bridge poller auto-resume after Codespace STOP/START — 2026-10-31 08:43 Europe/Rome

- Test Codespace haunted-shadow was explicitly stopped through GitHub UI, which displayed the successful stop notification. The user then opened the same Codespace normally; VS Code reappeared with an idle shell prompt. **No terminal commands were run after restarting it.**
- ChatGPT verified Cloudflare D1 had two prior successful jobs, the sole Ed25519 agent still approved (fingerprint 8fce8450fc2aa472), and enrollment closed (enroll_until=0).
- ChatGPT created a new uniquely identified fixed probe: probe-20261031-after-restart-0843, initially status=queued with created_at=1793432618.
- Without any agent startup/manual command, Cloudflare D1 showed it claimed at 1793432636 and completed at 1793432641.
- Final verified values: status=success, response=BRIDGE_OK, error='', same approved agent_id, lease cleared.
- Time from enqueue to claim = 18 seconds; from claim to result = 5 seconds.
- Conclusion: the experimental Codespace lifecycle configuration restored the Bridge background poller, whose Ed25519 authenticated polling and Antigravity CLI execution remained functional after a real stop/start. This confirms recovery of the *existing* authenticated Codespace only.
- **Boundary:** a stopped/idle Codespace cannot receive tasks until it starts again. This does not prove wake-on-demand or 24/7 connectivity. No billing/idle settings changed; no changes to main, working Codespace, unrelated Cloudflare Workers/D1 or production. Queue remains fixed read-only probe only.
- Next separate milestone: design scoped task types and authorization policy before enabling real software-development instructions; do not turn on arbitrary remote shell.

## Config.inspect bridge extension — 2026-10-31 (initial job pending)

- Separate `experiment/agy-config-control-20261031` branch contains the source and design for read-only CLI settings inspection.
- Created isolated D1 `config_jobs` table. Deployed Worker `agy-bridge-mvp` v0.3 with Ed25519 signed `config/claim` and `config/finish` routes and report field allowlist.
- Preserved the original `jobs` table and `probe` endpoints. Post-deploy compatibility verified: `probe-20261031-worker-v03-compat` returned `success` and `BRIDGE_OK` autonomously.
- Changed only experimental branch files `bridge/agent.py` and `bridge/config_control.py`. Existing Remote Control, supervised polling and devcontainer lifecycle scripts remain unchanged.
- Config inspect returns four cosmetic CLI settings (`verbosity`, `colorScheme`, `altScreenMode`, `runningLightSpeed`) and SHA-256 version; unexpected values become null, raw JSON/secrets are never returned. NO remote write/control enabled.
- Queued precisely one read-only job in D1: `config-20261031-readonly-initial-01`, currently `queued` pending Codespace source refresh.
- Required human-side action on already running **test** Codespace: `git pull --ff-only origin experiment/agy-codespaces-autostart-20261030`. The background supervisor reads updated files on its next 30-second cycle automatically; no CLI restart, rebuild or token setup needed.
- After user sync, ChatGPT verifies exact job result in D1. Do not claim config inspection is complete until the result is observed.
- **Not implemented:** config.plan/apply job types, or graphical UI button control. CLI settings and Antigravity IDE UI require distinct mechanisms.

## VERIFIED remote CLI settings inspection — 2026-10-31 09:21 Europe/Rome

- User fast-forward pulled experiment/agy-codespaces-autostart-20261030 inside existing test Codespace haunted-shadow. Screenshot showed updated bridge/agent.py, new bridge/config_control.py, and no merge conflicts.
- The already running Bridge supervisor (without any manual restart) automatically claimed and completed the pre-queued config job config-20261031-readonly-initial-01.
- Cloudflare D1 independently verified status=success, approved Ed25519 agent fingerprint=8fce8450fc2aa472, error empty, claimed_at=1793434906.
- Validated schema-reduced JSON returned SHA-256 f99423432ba6528ee62cbff006e620984be606ba0a6cd0f1d8fc81b0582a1f29 and all four allowed CLI preferences null: verbosity, colorScheme, altScreenMode, runningLightSpeed. Null indicates not explicitly configured with a recognized value; it is not evidence of current effective runtime overrides or Antigravity IDE/global UI settings.
- Official Google CLI reference confirms defaults for absent keys: verbosity medium, colorScheme terminal, altScreenMode default, runningLightSpeed medium, subject to launch/runtime overrides.
- No configuration was changed. No sensitive values, complete config JSON, account tokens, or key material returned.
- Worker v0.3 config.inspect endpoint works; original probe endpoint remained compatible, confirmed by successful probe-20261031-worker-v03-compat.
- **Next:** add tightly scoped remote config.plan/config.apply with compare-and-swap, snapshot/read-back/rollback and independent verification. GUI button control remains separate and unimplemented; do not misrepresent configuration-file editing as mouse click control.

## Bridge v0.4 config control — implementation checkpoint, 2026-10-31

- Official Antigravity docs verified CLI cosmetic keys `verbosity`, `colorScheme`, `altScreenMode`, `runningLightSpeed` in `~/.gemini/antigravity-cli/settings.json`. Some runtime flags may override persisted values.
- Implemented `bridge/config_control.py` local `inspect`, `plan`, `apply`, `rollback`. Apply uses exact setting/value allowlist, SHA-256 compare-and-swap, restrictive private local journal snapshot, atomic replace, readback; rollback rejects changed settings via digest verification.
- `bridge/agent.py` now handles only signed `config.inspect`, `config.plan`, `config.apply`, `config.rollback` jobs; invokes a fixed local tool, not arbitrary commands. Source updated in experiment/agy-codespaces-autostart-20261030; existing supervisor and postStartCommand unchanged.
- Isolated D1 `config_jobs` migration adds kind, key/value, expected SHA, approval bit, expiry and result fields. Existing successful `probe` jobs unchanged.
- Deployed isolated Cloudflare Worker `agy-bridge-mvp` version `0.4-config-control`, signed auth, allowlisted key/value checks, mutating jobs require D1 approval and not-expired authorization. Worker checks and sanitizes incoming status/result JSON.
- **Backward compatibility proven:** existing running supervisor autonomously completed post-deploy probe `probe-20261031-worker-config-v04` successfully with `BRIDGE_OK`.
- Added one read-only plan job `cfgplan-20261031-cosmetic-low-01`: change `verbosity` to `low`; status queued, approved=0 (not needed for planning). No setting changed.
- **NEXT:** sync current test Codespace with `git pull --ff-only origin experiment/agy-codespaces-autostart-20261030`, run `python3 -m py_compile bridge/config_control.py bridge/agent.py`; old supervisor picks up new source on next poll automatically. ChatGPT then verifies D1 result for plan. Only after a successful plan may ChatGPT queue a separately approved cosmetic apply with exact expected digest and short TTL. Then independently verify readback and queue rollback with exact post-apply SHA/TTL; verify original state restored.
- **Not verified yet:** live remote plan/apply/rollback and native GUI button control. Do not claim any Antigravity setting changed or that screenshots/buttons are accessible. Original production, main, working Codespace and payment controls unchanged.

## Config control v0.4 safeguard — pending test Codespace source refresh

- The experimental config controller, signed agent and Cloudflare Worker support only four cosmetic CLI settings. CAS SHA-256, local protected rollback snapshot, atomic replacement and readback are implemented. Changes to agent privilege, sandbox, model, billing and unrelated GitHub resources remain prohibited.
- Worker `agy-bridge-mvp` v0.4 deployed and verified backwards-compatible: pre-existing fixed-probe agent completed `probe-20261031-worker-config-v04` with success/BRIDGE_OK.
- Database schema `config_jobs` migrated in isolated `agy-bridge-mvp` D1; changes require approved=1, expected digest, valid key/value, and an expiry timestamp. No config mutation has been queued.
- Initial *read-only* `config.plan` request `cfgplan-20261031-cosmetic-low-01` was claimed by the still-running **old** Codespace agent before the new source was pulled. It did not execute the new operation. Explicitly closed this job with status=error and error=agent_update_pending to prevent retries; no settings changed.
- Next necessary user-side prerequisite: in the **already authorized test Codespace** run `git pull --ff-only origin experiment/agy-codespaces-autostart-20261030 && python3 -m py_compile bridge/config_control.py bridge/agent.py`. This does not touch main or rebuild the container. Background supervisor will read new source on its next poll.
- After confirmation: ChatGPT queues a *new unique* `config.plan` only, verifies output; then time-limited allowlisted apply, verifies D1 + readback, then rollback to original digest. Never enqueue an apply before confirmed plan.
- Native UI button control remains outside the present CLI configuration bridge; do not claim it is implemented.
