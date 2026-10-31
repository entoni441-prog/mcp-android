#!/usr/bin/env python3
"""One-shot guarded test of real TEST Codespace Remote Control child recovery.

Only available on 'Призрачная тень' experimental branch. Never touches the
supervisor, Bridge, other Codespaces, accounts, config or raw logs.
"""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".devcontainer" / "agy-remote.py"
BRANCH = "experiment/agy-codespaces-autostart-20261030"
STATE = Path.home() / ".local" / "state" / "agy-codespaces"
LOCK = STATE / "recovery-injection.lock"
WAIT_SECONDS = 22

def report(status, detail, **other):
    print(json.dumps({"status": status, "detail": detail, **other},
                     sort_keys=True, separators=(",", ":")))
    return 0 if status == "pass" else 1

def commands(pid):
    try:
        data = Path(f"/proc/{pid}/cmdline").read_bytes()
        return [x.decode("utf-8", "replace") for x in data.split(bytes([0])) if x]
    except OSError:
        return []

def children(pid):
    try:
        return [int(x) for x in
                Path(f"/proc/{pid}/task/{pid}/children").read_text().split()]
    except OSError:
        return []

def remote_child(pid):
    args = commands(pid)
    if len(args) < 2 or args[-1] != "--remote-control":
        return False
    # Native binary or script launched via a trusted interpreter (node/python).
    return Path(args[0]).name == "agy" or (len(args) >= 3 and Path(args[-2]).name == "agy")

def test_guard():
    name = os.environ.get("CODESPACE_NAME", "")
    if not re.fullmatch(r"haunted-shadow-[a-z0-9]+", name):
        raise ValueError("not_test_codespace")
    git = subprocess.run(["git", "branch", "--show-current"],
                         cwd=ROOT, capture_output=True, text=True, timeout=5)
    if git.returncode != 0 or git.stdout.strip() != BRANCH:
        raise ValueError("wrong_branch")
    if not SCRIPT.is_file():
        raise ValueError("runner_source_missing")
    spec = importlib.util.spec_from_file_location("agy_test_runner", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    parent = mod.running_pid()
    if not parent or not mod.is_runner(parent):
        raise ValueError("runner_not_running")
    matching = [pid for pid in children(parent) if remote_child(pid)]
    if len(matching) != 1:
        raise ValueError("expected_exactly_one_cli_child")
    if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        raise ValueError("pidfd_signal_not_supported")
    return parent, matching[0], mod

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("check", "inject"))
    args = parser.parse_args()
    try:
        parent, old_child, mod = test_guard()
    except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
        return report("blocked", str(exc))
    if args.action == "check":
        return report("pass", "ready_for_test", runner_running=True,
                      cli_child_running=True, pidfd_supported=True)
    if os.environ.get("AGY_TEST_CRASH_APPROVED") != "1":
        return report("blocked", "explicit_test_authorization_missing")
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return report("blocked", "test_already_running")
        parent, old_child, mod = test_guard()
        # Linux pidfd prevents signalling a reused process ID.
        child_fd = os.pidfd_open(old_child)
        try:
            if not mod.is_runner(parent) or old_child not in children(parent) or not remote_child(old_child):
                return report("blocked", "process_identity_changed")
            signal.pidfd_send_signal(child_fd, signal.SIGKILL, None, 0)
        finally:
            os.close(child_fd)
        deadline = time.monotonic() + WAIT_SECONDS
        while time.monotonic() < deadline:
            if not mod.is_runner(parent):
                return report("fail", "supervisor_exited_after_cli_crash",
                              runner_survived=False, cli_recovered=False)
            current = [pid for pid in children(parent) if remote_child(pid)]
            if len(current) == 1 and current[0] != old_child:
                return report("pass", "cli_recovered_after_sigkill",
                              runner_survived=True, cli_recovered=True,
                              new_child_detected=True)
            time.sleep(0.25)
        return report("fail", "cli_not_recovered_before_deadline",
                      runner_survived=True, cli_recovered=False)
    except (OSError, ValueError, ProcessLookupError):
        return report("blocked", "process_test_error")
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

if __name__ == "__main__":
    sys.exit(main())
