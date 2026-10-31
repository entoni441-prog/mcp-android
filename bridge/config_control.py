#!/usr/bin/env python3
"""AGY CLI cosmetic settings with redacted read, CAS writes and a private rollback journal.
Test Codespace only. No arbitrary keys, shell, permissions or credential output.
"""
import argparse
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

BRANCH = "experiment/agy-codespaces-autostart-20261030"
ROOT = Path("/workspaces/mcp-android")
CONFIG = Path.home() / ".gemini" / "antigravity-cli" / "settings.json"
JOURNAL = CONFIG.parent / ".agy-bridge-rollback.json"
LOCK = CONFIG.parent / ".agy-config-control.lock"
MAX_BYTES = 1024 * 1024
ALLOWED = {
    "verbosity": ("low", "medium", "high"),
    "colorScheme": ("terminal", "light", "solarized light", "colorblind-friendly light",
                    "dark", "solarized dark", "colorblind-friendly dark", "tokyo night"),
    "altScreenMode": ("default", "always", "never"),
    "runningLightSpeed": ("fast", "medium", "slow", "off"),
}
DIGEST = __import__("re").compile(r"(?:[0-9a-f]{64}|missing)\Z")

def emit(value):
    print(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")))

def safe_value(key, value):
    return value if isinstance(value, str) and value in ALLOWED[key] else None

def branch_guard():
    result = subprocess.run(["git", "branch", "--show-current"], cwd=ROOT,
                            capture_output=True, text=True, timeout=5, check=False)
    if result.returncode != 0 or result.stdout.strip() != BRANCH:
        raise RuntimeError("test_codespace_only")

def read():
    if CONFIG.is_symlink():
        raise RuntimeError("symlink_refused")
    if not CONFIG.exists():
        return {}, None, "missing"
    if not CONFIG.is_file() or CONFIG.stat().st_size > MAX_BYTES:
        raise RuntimeError("invalid_settings_file")
    raw = CONFIG.read_bytes()
    if len(raw) > MAX_BYTES:
        raise RuntimeError("oversized_settings")
    obj = json.loads(raw.decode("utf-8"))
    if not isinstance(obj, dict):
        raise RuntimeError("invalid_settings_object")
    return obj, raw, hashlib.sha256(raw).hexdigest()

def lock_config():
    CONFIG.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if CONFIG.parent.is_symlink():
        raise RuntimeError("directory_symlink_refused")
    fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    fcntl.flock(fd, fcntl.LOCK_EX)
    return fd

def atomic_write(path, content):
    fd, name = tempfile.mkstemp(prefix=".agy-safe-", dir=str(path.parent))
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as out:
            out.write(content)
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def journal():
    if JOURNAL.is_symlink():
        raise RuntimeError("journal_symlink_refused")
    if not JOURNAL.exists():
        return None
    if not JOURNAL.is_file() or JOURNAL.stat().st_size > 1500000:
        raise RuntimeError("invalid_journal")
    data = json.loads(JOURNAL.read_text("utf-8"))
    if not isinstance(data, dict) or data.get("version") != 1:
        raise RuntimeError("invalid_journal")
    return data

def inspect():
    obj, _, digest = read()
    emit({"status": "ok", "sha256": digest,
          "preferences": {k: safe_value(k, obj.get(k)) for k in ALLOWED}})

def plan(key, value):
    if key not in ALLOWED or value not in ALLOWED[key]:
        raise RuntimeError("setting_not_allowlisted")
    obj, _, digest = read()
    emit({"status": "dry_run", "key": key, "from": safe_value(key, obj.get(key)),
          "to": value, "expected_sha256": digest, "changed": obj.get(key) != value})

def apply(key, value, expected):
    if key not in ALLOWED or value not in ALLOWED[key] or not DIGEST.fullmatch(expected):
        raise RuntimeError("setting_not_allowlisted")
    fd = lock_config()
    try:
        obj, original, digest = read()
        if digest != expected:
            raise RuntimeError("settings_changed_since_plan")
        if obj.get(key) == value:
            emit({"status": "unchanged", "key": key, "value": value, "sha256": digest})
            return
        previous = safe_value(key, obj.get(key))
        changed = dict(obj)
        changed[key] = value
        new = (json.dumps(changed, ensure_ascii=False, indent=2) + "\n").encode()
        if len(new) > MAX_BYTES:
            raise RuntimeError("oversized_settings")
        next_digest = hashlib.sha256(new).hexdigest()
        previous_journal = journal()
        if previous_journal and previous_journal.get("state") == "active":
            raise RuntimeError("previous_rollback_pending")
        info = {"version": 1, "state": "active", "key": key, "value": value,
                "before_sha256": digest, "after_sha256": next_digest,
                "original_absent": original is None,
                "original_b64": base64.b64encode(original).decode() if original is not None else ""}
        # Journal contains potentially sensitive original settings: never emit it.
        atomic_write(JOURNAL, json.dumps(info, separators=(",", ":")).encode())
        atomic_write(CONFIG, new)
        readback, _, confirmation = read()
        if confirmation != next_digest or readback.get(key) != value:
            raise RuntimeError("readback_failed")
        emit({"status": "updated", "key": key, "from": previous, "to": value,
              "before_sha256": digest, "sha256": next_digest, "rollback_available": True,
              "runtime_reload_may_be_required": True})
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

def rollback(expected):
    if not DIGEST.fullmatch(expected):
        raise RuntimeError("invalid_digest")
    fd = lock_config()
    try:
        data = journal()
        if not data or data.get("state") != "active":
            raise RuntimeError("no_rollback_available")
        obj, _, digest = read()
        if digest != expected or expected != data.get("after_sha256"):
            raise RuntimeError("settings_changed_since_apply")
        original = base64.b64decode(data["original_b64"], validate=True)
        before = "missing" if data.get("original_absent") else hashlib.sha256(original).hexdigest()
        if before != data.get("before_sha256"):
            raise RuntimeError("backup_hash_mismatch")
        if data.get("original_absent"):
            CONFIG.unlink()
        else:
            atomic_write(CONFIG, original)
        _, _, verified = read()
        if verified != before:
            raise RuntimeError("rollback_readback_failed")
        data["state"] = "rolled_back"
        data["original_b64"] = ""
        atomic_write(JOURNAL, json.dumps(data, separators=(",", ":")).encode())
        emit({"status": "rolled_back", "key": data["key"], "sha256": verified,
              "runtime_reload_may_be_required": True})
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="action", required=True)
    sub.add_parser("inspect")
    a = sub.add_parser("plan")
    a.add_argument("key")
    a.add_argument("value")
    a = sub.add_parser("apply")
    a.add_argument("key")
    a.add_argument("value")
    a.add_argument("--expected-sha256", required=True)
    a = sub.add_parser("rollback")
    a.add_argument("--expected-sha256", required=True)
    args = p.parse_args()
    try:
        branch_guard()
        if args.action == "inspect":
            inspect()
        elif args.action == "plan":
            plan(args.key, args.value)
        elif args.action == "apply":
            apply(args.key, args.value, args.expected_sha256)
        else:
            rollback(args.expected_sha256)
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        ident = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        emit({"status": "error", "error": ident[:64]})
        return 1

if __name__ == "__main__":
    sys.exit(main())
