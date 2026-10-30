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
