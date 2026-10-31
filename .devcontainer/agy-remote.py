#!/usr/bin/env python3
"""Experimental Codespaces Remote Control runner; no systemd or tmux."""
import errno
import os
import pty
import shutil
import signal
import subprocess
import sys
from pathlib import Path

STATE = Path.home() / ".local" / "state" / "agy-codespaces"
PID_FILE = STATE / "remote.pid"
LOG_FILE = STATE / "remote.log"


def running_pid():
    try:
        pid = int(PID_FILE.read_text().strip())
        os.kill(pid, 0)
        return pid
    except (FileNotFoundError, ValueError, ProcessLookupError, PermissionError):
        return None


def agy_binary():
    candidate = Path.home() / ".local" / "bin" / "agy"
    return str(candidate) if candidate.is_file() and os.access(candidate, os.X_OK) else shutil.which("agy")


def start():
    if running_pid():
        print("Antigravity Remote Control runner is already active.")
        return 0
    agy = agy_binary()
    if not agy:
        print("Antigravity CLI not installed; skipping autostart safely.")
        return 0
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(STATE, 0o700)
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
    print(f"Started test Remote Control runner (PID {proc.pid}).")
    print("Experimental: confirm Online status at antigravity.google.com.")
    return 0


def serve():
    agy = os.environ.get("AGY_BIN") or agy_binary()
    if not agy:
        print("agy binary missing", flush=True)
        return 1
    pid, master_fd = pty.fork()
    if pid == 0:
        os.execv(agy, [agy, "--remote-control"])

    def shutdown(signum, frame):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    signal.signal(signal.SIGTERM, shutdown)
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
        os.waitpid(pid, 0)
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
