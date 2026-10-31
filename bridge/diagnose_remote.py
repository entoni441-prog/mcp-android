#!/usr/bin/env python3
"""Read-only Codespaces Remote Control health report; never outputs raw logs/URLs."""
import json
import os
from pathlib import Path
import re
import time

STATE = Path.home() / ".local/state/agy-codespaces"
PID = STATE / "remote.pid"
LOG = STATE / "remote.log"

def command(pid):
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
        return [x.decode("utf-8", "replace") for x in raw.split(b"\0") if x]
    except (OSError, ValueError):
        return []

def children(pid):
    try:
        contents = Path(f"/proc/{pid}/task/{pid}/children").read_text("ascii")
        return [int(x) for x in contents.split()]
    except (OSError, ValueError):
        return []

def report():
    result = {"component": "test_codespace_remote_control",
              "runner": "unknown", "cli_child": "unknown",
              "log_age_seconds": None, "log_signal": "none",
              "remote_instance_online": "not_checked"}
    try:
        pid = int(PID.read_text("ascii").strip())
    except (OSError, ValueError):
        result["runner"] = "not_running_or_missing_pid"
        return result
    args = command(pid)
    if not args:
        result["runner"] = "not_running_or_unreadable"
    elif any("agy-remote.py" in x for x in args) and "serve" in args:
        result["runner"] = "running"
        result["cli_child"] = "running" if any(
            "--remote-control" in command(c) for c in children(pid)
        ) else "absent"
    else:
        result["runner"] = "pid_not_expected_process"
    try:
        stat = LOG.stat()
        result["log_age_seconds"] = max(0, int(time.time() - stat.st_mtime))
        with LOG.open("rb") as stream:
            stream.seek(max(0, stat.st_size - 65536))
            tail = stream.read(65536).decode("utf-8", "replace").lower()
        # Return only controlled enum values; never print log lines, URLs or tokens.
        patterns = (
            ("authentication_required", r"not signed in|authentication required|login required|sign.in required"),
            ("remote_link_present", r"remote control on|antigravity\.google\.com/r/"),
            ("error_reported", r"\berror\b|\bfailed\b|permission denied"),
        )
        matches = [(m.start(), label) for label, expr in patterns for m in re.finditer(expr, tail)]
        if matches:
            result["log_signal"] = max(matches, key=lambda item: item[0])[1]
    except OSError:
        result["log_signal"] = "unavailable"
    return result

if __name__ == "__main__":
    print(json.dumps(report(), sort_keys=True, separators=(",", ":")))
