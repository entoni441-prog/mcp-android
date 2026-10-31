#!/usr/bin/env python3
"""Experimental Codespaces Remote Control runner; no systemd or tmux.

Bounded self-recovery for unexpected interactive CLI exits. Does NOT prevent
GitHub Codespaces idle shutdown; no account/security/billing changes.
"""
import errno
import fcntl
import os
import pty
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

STATE = Path.home() / ".local" / "state" / "agy-codespaces"
PID_FILE = STATE / "remote.pid"
LOG_FILE = STATE / "remote.log"
LOCK_FILE = STATE / "start.lock"
RESTART_DELAYS = (5, 20)  # Three CLI launch attempts total.


def is_runner(pid):
    """Validate identity before accepting or signalling PID; prevent PID reuse."""
    if pid <= 1:
        return False
    try:
        os.kill(pid, 0)
        command = [part.decode("utf-8", "replace") for part in
                   Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\\0") if part]
        status = Path(f"/proc/{pid}/stat").read_text().split()
        return (len(command) >= 3 and command[-1] == "serve" and
                Path(command[-2]).name == "agy-remote.py" and
                len(status) > 2 and status[2] != "Z")
    except (OSError, ValueError):
        return False


def running_pid():
    try:
        pid = int(PID_FILE.read_text().strip())
        return pid if is_runner(pid) else None
    except (OSError, ValueError):
        return None


def agy_binary():
    candidate = Path.home() / ".local" / "bin" / "agy"
    return str(candidate) if candidate.is_file() and os.access(candidate, os.X_OK) else shutil.which("agy")


def start():
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(STATE, 0o700)
    fd = os.open(LOCK_FILE, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        if running_pid():
            print("Antigravity Remote Control runner is already active.")
            return 0
        agy = agy_binary()
        if not agy:
            print("Antigravity CLI not installed; skipping autostart safely.")
            return 0
        with LOG_FILE.open("ab") as log:
            os.chmod(LOG_FILE, 0o600)
            proc = subprocess.Popen(
                [sys.executable, str(Path(__file__).resolve()), "serve"],
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                env={**os.environ, "AGY_BIN": agy},
            )
        PID_FILE.write_text(str(proc.pid) + "\n")
        os.chmod(PID_FILE, 0o600)
        time.sleep(0.25)
        if proc.poll() is not None:
            if PID_FILE.exists() and PID_FILE.read_text().strip() == str(proc.pid):
                PID_FILE.unlink()
            print("Antigravity Remote Control runner exited immediately.")
            return 1
        print(f"Started test Remote Control runner (PID {proc.pid}).")
        print("Experimental: confirm Online status at antigravity.google.com.")
        return 0
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def run_session(agy, stopped, child_state):
    """Run one CLI in a private PTY; no shell commands from remote clients."""
    pid, master_fd = pty.fork()
    if pid == 0:
        os.execv(agy, [agy, "--remote-control"])
    child_state["pid"] = pid
    try:
        while True:
            try:
                chunk = os.read(master_fd, 8192)
            except OSError as exc:
                if exc.errno == errno.EIO:
                    break
                raise
            if not chunk:
                break
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()
    finally:
        os.close(master_fd)
        _, status = os.waitpid(pid, 0)
        child_state["pid"] = None
    return os.waitstatus_to_exitcode(status)


def serve():
    agy = os.environ.get("AGY_BIN") or agy_binary()
    if not agy:
        print("agy binary missing", flush=True)
        return 1
    stopped = threading.Event()
    child_state = {"pid": None}

    def mark_stop(_signum, _frame):
        stopped.set()
        pid = child_state["pid"]
        if pid is not None:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

    signal.signal(signal.SIGTERM, mark_stop)
    try:
        for attempt in range(len(RESTART_DELAYS) + 1):
            if stopped.is_set():
                break
            if attempt:
                delay = RESTART_DELAYS[attempt - 1]
                print(f"CLI exited; bounded restart {attempt}/{len(RESTART_DELAYS)} in {delay}s.", flush=True)
                if stopped.wait(delay):
                    break
            rc = run_session(agy, stopped, child_state)
            if stopped.is_set():
                break
            print(f"Remote Control CLI exited (code {rc}).", flush=True)
        else:
            print("Remote Control restart budget exhausted; inspect local status.", flush=True)
    finally:
        try:
            if PID_FILE.read_text().strip() == str(os.getpid()):
                PID_FILE.unlink()
        except FileNotFoundError:
            pass
    return 0


def stop():
    pid = running_pid()
    if not pid:
        print("No active runner.")
        return 0
    os.kill(pid, signal.SIGTERM)
    print(f"Sent stop signal to runner {pid}.")
    return 0


def status():
    pid = running_pid()
    print(f"runner PID: {pid}" if pid else "runner not running")
    print(f"log: {LOG_FILE}")
    return 0


def start_all():
    # Preserve the previously verified Remote Control startup unchanged.
    result = start()
    # Bridge is strictly optional; never break the existing lifecycle hook.
    launcher = Path(__file__).resolve().parent.parent / "bridge" / "supervisor.py"
    if launcher.is_file():
        try:
            subprocess.run([sys.executable, str(launcher), "start"], timeout=10,
                           check=False)
        except (OSError, subprocess.TimeoutExpired):
            print("Bridge start deferred; Remote Control unaffected.")
    return result


if __name__ == "__main__":
    actions = {"start": start_all, "serve": serve, "stop": stop, "status": status}
    if len(sys.argv) != 2 or sys.argv[1] not in actions:
        print("Usage: python3 agy-remote.py {start|status|stop}", file=sys.stderr)
        sys.exit(2)
    sys.exit(actions[sys.argv[1]]())
