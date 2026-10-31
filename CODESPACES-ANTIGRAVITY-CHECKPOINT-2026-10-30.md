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
