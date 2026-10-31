#!/usr/bin/env python3
"""One-shot text consultation -> UTF-8 Markdown -> GitHub TEST branch.

Does not implement, publish or run Windows control software.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone

REPO = "entoni441-prog/mcp-android"
BRANCH = "experiment/agy-codespaces-autostart-20261030"
CODESPACE = "haunted-shadow-6vwp64vgwxjgc6jg"
TASK_LABEL = "Antigravity TEST — консультация по Windows Agent v3 (только текст)"
ROOT = Path(__file__).resolve().parents[1]
REL_REPORT = "bridge/reports/ANTIGRAVITY-WINDOWS-V3-CONSULTATION-20261031.md"
LOCAL_REPORT = ROOT / REL_REPORT
AGY_BIN = "/home/codespace/.local/bin/agy"
MAX_BYTES = 24000

def emit(status, **fields):
    print(json.dumps({"status": status, **fields}, ensure_ascii=False, sort_keys=True), flush=True)

def branch_now():
    p = subprocess.run(["git", "-C", str(ROOT), "branch", "--show-current"],
                       capture_output=True, text=True, timeout=8)
    return p.stdout.strip() if p.returncode == 0 else ""

def run():
    if os.environ.get("CODESPACE_NAME") != CODESPACE:
        emit("stopped", reason="not_the_authorized_test_codespace")
        return 2
    if branch_now() != BRANCH:
        emit("stopped", reason="not_the_authorized_test_branch")
        return 2
    if LOCAL_REPORT.exists():
        emit("stopped", reason="report_already_exists", path=REL_REPORT)
        return 2
    data = json.loads((ROOT / ".vscode" / "tasks.json").read_text(encoding="utf-8"))
    matches = [t for t in data.get("tasks", []) if t.get("label") == TASK_LABEL]
    if len(matches) != 1:
        emit("stopped", reason="consultation_task_missing_or_ambiguous")
        return 2
    task = matches[0]
    args = task.get("args", [])
    if (task.get("command") != AGY_BIN or len(args) != 8 or
        args[0] != "-p" or not isinstance(args[1], str) or
        args[2:] != ["--mode", "plan", "--output-format", "text", "--print-timeout", "2m"]):
        emit("stopped", reason="consultation_arguments_changed")
        return 2
    if not Path(AGY_BIN).is_file():
        emit("stopped", reason="agy_cli_not_installed")
        return 2
    try:
        p = subprocess.run([AGY_BIN, *args], cwd=ROOT, capture_output=True,
                           text=True, encoding="utf-8", errors="replace",
                           timeout=150, check=False)
    except subprocess.TimeoutExpired:
        emit("stopped", reason="agy_consultation_timeout")
        return 3
    if p.returncode != 0:
        # Do not leak stderr because CLI errors can carry account URLs.
        emit("stopped", reason="agy_cli_nonzero_exit", exit_code=p.returncode)
        return 3
    answer = re.sub(r"\x1b\[[0-9;]*[ -/]*[@-~]", "", p.stdout).strip()
    encoded = answer.encode("utf-8")
    if not (80 <= len(encoded) <= MAX_BYTES):
        emit("stopped", reason="output_empty_or_size_out_of_bounds", bytes=len(encoded))
        return 3
    if re.search(r"-----BEGIN [A-Z ]*PRIVATE KEY-----|github_pat_|ghp_[A-Za-z0-9]|sk-[A-Za-z0-9]{15,}|AKIA[0-9A-Z]{16}",
                 answer, re.IGNORECASE):
        emit("stopped", reason="possible_secret_in_answer")
        return 3
    source_hash = hashlib.sha256(encoded).hexdigest()
    timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    report = (
        "# Независимая консультация Antigravity — Windows PC Agent v3\n\n"
        f"- Время UTC: {timestamp}\n"
        f"- Источник: Antigravity CLI (Codespace {CODESPACE})\n"
        "- Режим: plan, text-only; рекомендации не выполнялись\n"
        f"- Код выхода CLI: {p.returncode}\n"
        f"- Длина ответа UTF-8: {len(encoded)} байт\n"
        f"- SHA-256 исходного ответа: {source_hash}\n"
        "- Статус: получен полный stdout от CLI, без обрезки терминала\n\n"
        "## Ответ Antigravity\n\n" + answer + "\n"
    )
    LOCAL_REPORT.parent.mkdir(parents=True, exist_ok=True)
    with LOCAL_REPORT.open("x", encoding="utf-8") as out:
        out.write(report)
    # Create only the dedicated report using authenticated GitHub Contents API,
    # without staging any local untracked files or modifying source code.
    gh = shutil.which("gh")
    if not gh:
        emit("local_saved", reason="gh_cli_unavailable", path=REL_REPORT, sha256=source_hash, bytes=len(encoded))
        return 0
    payload = {
        "message": "docs(agy): save text-only independent Windows v3 audit",
        "branch": BRANCH,
        "content": base64.b64encode(report.encode("utf-8")).decode("ascii")
    }
    try:
        upload = subprocess.run(
            [gh, "api", "-X", "PUT", f"repos/{REPO}/contents/{REL_REPORT}", "--input", "-"],
            input=json.dumps(payload, ensure_ascii=False), text=True,
            capture_output=True, timeout=35, check=False)
    except subprocess.TimeoutExpired:
        emit("local_saved", reason="github_upload_timeout", path=REL_REPORT, sha256=source_hash, bytes=len(encoded))
        return 0
    if upload.returncode != 0:
        emit("local_saved", reason="github_upload_failed", path=REL_REPORT,
             exit_code=upload.returncode, sha256=source_hash, bytes=len(encoded))
        return 0
    emit("published", path=REL_REPORT, sha256=source_hash, bytes=len(encoded),
         github_url=f"https://github.com/{REPO}/blob/{BRANCH}/{REL_REPORT}")
    return 0

if __name__ == "__main__":
    try:
        sys.exit(run())
    except (OSError, ValueError, KeyError) as e:
        emit("stopped", reason=type(e).__name__)
        sys.exit(4)
