#!/usr/bin/env python3
"""Install a pinned background poller into the EXISTING test Codespace only."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BRANCH = "experiment/agy-codespaces-autostart-20261030"
SOURCE_BRANCH = "experiment/agy-bridge-mcp-20261031"
SOURCE_COMMIT = "570a82a8dfa6dce348a59a919d0b0096047548b9"
EXPECTED_BLOB = "8699bb514092d9fea230a0f752a2affc42a4c867"
TARGET = ROOT / "bridge" / "supervisor.py"

def run(args, timeout=30):
    return subprocess.run(args, cwd=ROOT, capture_output=True, timeout=timeout, check=True)

def main():
    try:
        current = run(["git", "branch", "--show-current"], timeout=5).stdout.decode().strip()
        if current != BRANCH:
            print("Stopped: wrong experimental branch", file=sys.stderr)
            return 2
        if not (ROOT / "bridge" / "agent.py").is_file():
            print("Stopped: signed agent source missing. Sync the test branch first.", file=sys.stderr)
            return 2
        run(["git", "fetch", "--no-tags", "origin", SOURCE_BRANCH], timeout=45)
        data = run(["git", "show", SOURCE_COMMIT + ":bridge/supervisor.py"], timeout=10).stdout
        blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if blob != EXPECTED_BLOB:
            print("Stopped: supervisor source checksum mismatch", file=sys.stderr)
            return 3
        compile(data, str(TARGET), "exec")
        if TARGET.exists():
            if TARGET.read_bytes() != data:
                print("Stopped: local supervisor differs; refusing overwrite", file=sys.stderr)
                return 3
        else:
            fd = os.open(TARGET, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
        print("Verified supervisor source installed (no credentials copied).")
        launcher = run([sys.executable, ".devcontainer/agy-remote.py", "start"], timeout=22)
        print(launcher.stdout.decode("utf-8", "replace").strip())
        status = run([sys.executable, "bridge/supervisor.py", "status"], timeout=6)
        print(status.stdout.decode("utf-8", "replace").strip())
        return 0
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, SyntaxError):
        print("Installation halted; no secrets disclosed. Inspect local git and network status.", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
