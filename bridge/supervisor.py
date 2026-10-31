#!/usr/bin/env python3
"""Detached fixed-probe poller for the already-approved experimental Codespace.
No systemd, tmux, token copying, auto-enrollment, rebuild or idle-timeout bypass.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import threading

EXPECTED_BRANCH = "experiment/agy-codespaces-autostart-20261030"
EXPECTED_AGENT_ID = "8fce8450fc2aa4725c1b10cd7e3819edfdad6542af7c59e30597c9b98426c6e3"
BRIDGE_URL = "https://agy-bridge-mvp.entoni441.workers.dev"
ROOT = Path(__file__).resolve().parents[1]
AGENT = ROOT / "bridge" / "agent.py"
IDENTITY = Path.home() / ".config" / "agy-bridge" / "identity.pem"
STATE = Path.home() / ".local" / "state" / "agy-bridge"
PID_FILE = STATE / "supervisor.pid"
LOCK_FILE = STATE / "supervisor.lock"
LOG_FILE = STATE / "supervisor.log"
HEALTH_FILE = STATE / "status.json"
INTERVAL = 30
MAX_BACKOFF = 180
CHILD_TIMEOUT = 130
EXIT = False
STOP_EVENT = threading.Event()
CHILD = None

def agent_cli():
    path = Path.home() / ".local" / "bin" / "agy"
    return str(path) if path.is_file() and os.access(path, os.X_OK) else shutil.which("agy")

def current_branch():
    result = subprocess.run(["git", "branch", "--show-current"], cwd=str(ROOT),
                            capture_output=True, text=True, timeout=5, check=False)
    return result.stdout.strip() if result.returncode == 0 else ""

def paired_identity():
    if not IDENTITY.is_file() or not os.access(IDENTITY, os.R_OK):
        return False
    if IDENTITY.stat().st_mode & 0o077:
        return False
    try:
        pub = subprocess.run(["openssl", "pkey", "-in", str(IDENTITY), "-pubout",
                              "-outform", "DER"], capture_output=True, check=True, timeout=8).stdout
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return False
    return hashlib.sha256(pub).hexdigest() == EXPECTED_AGENT_ID

def prerequisites():
    if current_branch() != EXPECTED_BRANCH:
        return "wrong_branch"
    if not AGENT.is_file():
        return "agent_source_missing"
    if not paired_identity():
        return "approved_identity_missing"
    if not agent_cli():
        return "agy_cli_missing"
    if not shutil.which("curl"):
        return "curl_missing"
    return None

def create_state():
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(STATE, 0o700)

def write_private(path, value):
    tmp = path.with_name(path.name + ".tmp." + str(os.getpid()))
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            file.write(value)
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()

def active_pid():
    try:
        pid = int(PID_FILE.read_text().strip())
        if pid <= 1:
            return None
        cmdline = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ")
        if b"supervisor.py serve" not in cmdline:
            return None
        os.kill(pid, 0)
        return pid
    except (OSError, ValueError):
        return None

def record(event, code=""):
    create_state()
    previous = {}
    try:
        previous = json.loads(HEALTH_FILE.read_text())
    except (ValueError, OSError):
        pass
    previous.update({"event": event, "code": code, "checked_at": int(time.time())})
    write_private(HEALTH_FILE, json.dumps(previous, separators=(",", ":")) + "\n")

def child_env():
    """Allow required runtime variables only, not Codespaces/GitHub credentials."""
    safe = ("HOME", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR",
            "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME",
            "XDG_STATE_HOME", "TERM", "SSL_CERT_FILE", "CURL_CA_BUNDLE")
    return {key: os.environ[key] for key in safe if key in os.environ}

def start():
    reason = prerequisites()
    if reason:
        print("Bridge autostart skipped: " + reason)
        return 0
    if active_pid():
        print("Bridge poller already running.")
        return 0
    create_state()
    fd = os.open(str(LOG_FILE), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.chmod(LOG_FILE, 0o600)
    with os.fdopen(fd, "ab") as log:
        proc = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "serve"],
                                cwd=str(ROOT), stdin=subprocess.DEVNULL,
                                stdout=log, stderr=subprocess.STDOUT,
                                start_new_session=True, close_fds=True,
                                env=child_env())
    for _ in range(20):
        if active_pid():
            print("Bridge poller started.")
            return 0
        if proc.poll() is not None:
            break
        time.sleep(0.1)
    print("Bridge poller launch not confirmed; inspect status.")
    return 1

def sigterm(_signal, _frame):
    global EXIT, CHILD
    EXIT = True
    STOP_EVENT.set()
    if CHILD is not None and CHILD.poll() is None:
        CHILD.terminate()

def serve():
    global CHILD
    create_state()
    lock_fd = os.open(str(LOCK_FILE), os.O_CREAT | os.O_RDWR, 0o600)
    try:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        reason = prerequisites()
        if reason:
            record("not_started", reason)
            return 1
        write_private(PID_FILE, str(os.getpid()) + "\n")
        signal.signal(signal.SIGTERM, sigterm)
        signal.signal(signal.SIGINT, sigterm)
        record("running")
        backoff = INTERVAL
        while not EXIT:
            command = [sys.executable, str(AGENT), "--once"]
            env = child_env()
            env["AGY_BRIDGE_URL"] = BRIDGE_URL
            try:
                CHILD = subprocess.Popen(command, cwd=str(ROOT), env=env,
                                         stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                         stderr=subprocess.PIPE, close_fds=True)
                try:
                    _stdout, _stderr = CHILD.communicate(timeout=CHILD_TIMEOUT)
                    code = CHILD.returncode
                except subprocess.TimeoutExpired:
                    CHILD.kill()
                    CHILD.communicate()
                    code = 124
                finally:
                    CHILD = None
                record("polled" if code == 0 else "retrying", str(code))
                backoff = INTERVAL if code == 0 else min(MAX_BACKOFF, backoff * 2)
            except OSError:
                CHILD = None
                record("retrying", "spawn_error")
                backoff = min(MAX_BACKOFF, backoff * 2)
            if not EXIT:
                STOP_EVENT.wait(backoff)
        record("stopped")
        return 0
    finally:
        try:
            if PID_FILE.read_text().strip() == str(os.getpid()):
                PID_FILE.unlink()
        except OSError:
            pass
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        os.close(lock_fd)

def stop():
    pid = active_pid()
    if not pid:
        print("Bridge poller already stopped.")
        return 0
    os.kill(pid, signal.SIGTERM)
    print("Sent Bridge poller stop signal.")
    return 0

def status():
    pid = active_pid()
    print("Bridge poller: running" if pid else "Bridge poller: stopped")
    if HEALTH_FILE.is_file():
        try:
            data = json.loads(HEALTH_FILE.read_text())
            print("Last event:", data.get("event", "unknown"), "at", data.get("checked_at", "unknown"))
        except (OSError, ValueError):
            pass
    return 0

if __name__ == "__main__":
    commands = {"start": start, "serve": serve, "stop": stop, "status": status}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        print("Usage: supervisor.py {start|status|stop}", file=sys.stderr)
        sys.exit(2)
    sys.exit(commands[sys.argv[1]]())
