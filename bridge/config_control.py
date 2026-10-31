#!/usr/bin/env python3
"""Bounded AGY CLI settings inspector/editor. Experimental; not wired into Bridge.

Never displays unrecognized keys, account tokens, MCP credentials or full JSON.
A persistent CLI setting is NOT necessarily a currently active runtime override.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

EXPECTED_BRANCH = "experiment/agy-codespaces-autostart-20261030"
WORKSPACE = Path("/workspaces/mcp-android")
CONFIG = Path.home() / ".gemini" / "antigravity-cli" / "settings.json"
MAX_BYTES = 1024 * 1024
ALLOWED = {
    # Deliberately *only* non-privilege-escalating options in MVP.
    "verbosity": ("low", "medium", "high"),
    "colorScheme": (
        "terminal", "light", "solarized light", "colorblind-friendly light",
        "dark", "solarized dark", "colorblind-friendly dark", "tokyo night"
    ),
    "altScreenMode": ("default", "always", "never"),
    "runningLightSpeed": ("fast", "medium", "slow", "off"),
}
# Explicitly not supported: toolPermission, agentMode, sandbox,
# non-workspace access, telemetry, plugins, hooks, MCP and account settings.


def emit(data):
    print(json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


def branch_ok():
    result = subprocess.run(["git", "branch", "--show-current"],
                            cwd=WORKSPACE, check=False, capture_output=True,
                            text=True, timeout=5)
    return result.returncode == 0 and result.stdout.strip() == EXPECTED_BRANCH


def read_config():
    if CONFIG.is_symlink():
        raise RuntimeError("symlink_refused")
    if not CONFIG.is_file():
        return {}, None, "missing"
    if CONFIG.stat().st_size > MAX_BYTES:
        raise RuntimeError("oversized_settings")
    with CONFIG.open("rb") as handle:
        raw = handle.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise RuntimeError("oversized_settings")
    obj = json.loads(raw.decode("utf-8"))
    if not isinstance(obj, dict):
        raise RuntimeError("invalid_object")
    return obj, raw, hashlib.sha256(raw).hexdigest()


def inspect():
    if not branch_ok():
        raise RuntimeError("test_codespace_only")
    settings, _raw, digest = read_config()
    # Only disclose allowlisted preference values, not any other settings.
    allowed = {key: settings.get(key, None) for key in ALLOWED}
    emit({"status": "ok", "sha256": digest, "preferences": allowed,
          "note": "null means default/not explicitly set; runtime overrides excluded"})


def plan(key, value):
    if not branch_ok():
        raise RuntimeError("test_codespace_only")
    if key not in ALLOWED or value not in ALLOWED[key]:
        raise RuntimeError("setting_not_allowlisted")
    settings, _raw, digest = read_config()
    emit({"status": "dry_run", "key": key, "from": settings.get(key),
          "to": value, "expected_sha256": digest})


def apply(key, value, expected):
    if not branch_ok():
        raise RuntimeError("test_codespace_only")
    if key not in ALLOWED or value not in ALLOWED[key]:
        raise RuntimeError("setting_not_allowlisted")
    CONFIG.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_file = CONFIG.parent / ".agy-config-control.lock"
    lock_fd = os.open(lock_file, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        settings, old_bytes, digest = read_config()
        if expected != digest:
            raise RuntimeError("settings_changed_since_plan")
        previous = settings.get(key)
        if previous == value:
            emit({"status": "unchanged", "key": key, "value": value})
            return
        updated = dict(settings)
        updated[key] = value
        blob = (json.dumps(updated, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        if len(blob) > MAX_BYTES:
            raise RuntimeError("oversized_settings")
        # Keep a single private, pre-write backup in the same directory.
        backup = CONFIG.parent / "settings.json.agy-bridge-backup"
        if old_bytes is not None:
            if backup.is_symlink():
                raise RuntimeError("backup_symlink_refused")
            bfd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
            with os.fdopen(bfd, "wb") as target:
                target.write(old_bytes)
                target.flush()
                os.fsync(target.fileno())
        fd, temporary = tempfile.mkstemp(prefix=".agy-settings-", dir=CONFIG.parent)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "wb") as target:
                target.write(blob)
                target.flush()
                os.fsync(target.fileno())
            os.replace(temporary, CONFIG)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        # Read-back confirmation, not proof the currently running CLI reloaded it.
        verified, _raw, _sha = read_config()
        if verified.get(key) != value:
            raise RuntimeError("readback_failed")
        emit({"status": "updated", "key": key, "from": previous,
              "to": value, "saved": True, "runtime_restart_may_be_required": True})
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        os.close(lock_fd)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("inspect")
    p = sub.add_parser("plan")
    p.add_argument("key")
    p.add_argument("value")
    a = sub.add_parser("apply")
    a.add_argument("key")
    a.add_argument("value")
    a.add_argument("--expected-sha256", required=True)
    args = parser.parse_args()
    try:
        if args.action == "inspect":
            inspect()
        elif args.action == "plan":
            plan(args.key, args.value)
        else:
            apply(args.key, args.value, args.expected_sha256)
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as ex:
        # Never print paths, arbitrary configuration content or traceback.
        tag = str(ex) if isinstance(ex, RuntimeError) else type(ex).__name__
        emit({"status": "error", "error": tag[:60]})
        return 1


if __name__ == "__main__":
    sys.exit(main())
