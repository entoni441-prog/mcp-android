# Antigravity Codespaces autostart — experiment only

This branch is isolated from `main`. It does not change Android sources, Cloudflare or Actions.

## What it does

The Codespaces `postStartCommand` calls `python3 .devcontainer/agy-remote.py start`.
The runner starts the officially documented `agy --remote-control` CLI mode inside a pseudoterminal (Python standard library), without tmux or systemd.

- If `agy` is absent, startup is skipped without error.
- It does not install the CLI, access credentials or send commits.
- Local PID and log are in `~/.local/state/agy-codespaces/` with restricted file permissions.
- `python3 .devcontainer/agy-remote.py status` checks the runner process; **not** whether Google reports the instance online.
- `python3 .devcontainer/agy-remote.py stop` stops it.
- Check actual connectivity at https://antigravity.google.com/ while the Codespace is running.

## Important unverified behavior

Test in Codespaces itself before relying on this launcher. The standalone runner was syntax-tested and smoke-tested with a mock CLI; actual interactive CLI operation under a pseudoterminal and after a Codespaces restart has not yet been verified.

Adding or changing devcontainer settings requires a new Codespace or a container rebuild. **Rebuilding can remove user-installed binaries and credentials from locations outside /workspaces**. Do not rebuild the currently working Codespace without backing up essential state and preparing reauthorization.

This setup does not prevent GitHub Codespaces from stopping on idle, nor does it avoid Codespaces compute/storage quota. It does not automatically wake a stopped Codespace. The `postStartCommand` only runs after Codespaces is started.

No secrets should be committed to the repository.
