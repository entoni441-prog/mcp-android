#!/usr/bin/env python3
"""Minimal Codespaces bridge worker. Runs fixed read-only probe only; no arbitrary prompts."""
import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PROMPT = "Reply with exactly BRIDGE_OK. Do not use tools or modify files."
PROBE_SECONDS = 80


def request_json(endpoint, path, token, data):
    body = json.dumps(data, separators=(",", ":")).encode()
    req = urllib.request.Request(
        endpoint + path,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
    )
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)


def execute_probe():
    cli = os.path.expanduser("~/.local/bin/agy")
    if not (os.path.isfile(cli) and os.access(cli, os.X_OK)):
        cli = shutil.which("agy")
    if not cli:
        return {"status": "error", "error": "agy_not_installed"}
    # Never pass the bridge's bearer token to the Antigravity subprocess.
    child_env = {k: v for k, v in os.environ.items() if not k.startswith("AGY_BRIDGE_")}
    cmd = [cli, "-p", PROMPT, "--output-format", "json", "--sandbox", "--print-timeout", "1m"]
    try:
        completed = subprocess.run(cmd, text=True, capture_output=True, timeout=PROBE_SECONDS,
                                   cwd=os.environ.get("AGY_BRIDGE_WORKSPACE", "/workspaces/mcp-android"),
                                   env=child_env)
        if completed.returncode != 0:
            return {"status": "error", "error": "agy_exit_nonzero"}
        obj = json.loads(completed.stdout)
        if obj.get("status") != "SUCCESS":
            return {"status": "error", "error": "agy_status_not_success"}
        response = str(obj.get("response", "")).strip()
        if response != "BRIDGE_OK":
            return {"status": "error", "error": "unexpected_probe_response"}
        return {"status": "success", "response": response, "usage": obj.get("usage", {})}
    except subprocess.TimeoutExpired:
        return {"status": "error", "error": "agy_timeout"}
    except (ValueError, OSError):
        return {"status": "error", "error": "invalid_cli_response"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="check queue once and exit (safe default)")
    parser.add_argument("--loop", action="store_true", help="poll repeatedly (only after validation)")
    args = parser.parse_args()
    if not args.once and not args.loop:
        parser.error("Specify --once or --loop")
    endpoint = os.environ.get("AGY_BRIDGE_URL", "").rstrip("/")
    token = os.environ.get("AGY_BRIDGE_AGENT_TOKEN", "")
    if not endpoint.startswith("https://") or not token or len(token) < 32:
        print("bridge endpoint/agent secret not configured", file=sys.stderr)
        return 2
    agent_id = re.sub(r"[^a-zA-Z0-9_.-]", "-", socket.gethostname())[:64]
    while True:
        try:
            job = request_json(endpoint, "/v1/agent/claim", token, {"agent_id": agent_id}).get("job")
            if job:
                if job.get("kind") != "probe":
                    print("Unexpected job type rejected", file=sys.stderr)
                    return 1
                result = execute_probe()
                payload = {"agent_id": agent_id, **result}
                reply = request_json(endpoint, "/v1/agent/jobs/" + job["id"] + "/finish", token, payload)
                print("job " + job["id"] + ": " + result["status"] + " accepted=" + str(reply.get("accepted")))
            else:
                print("No queued probe jobs.")
        except (urllib.error.URLError, ValueError, TimeoutError, KeyError) as error:
            print("Bridge connection error (no credentials shown)", file=sys.stderr)
            if args.once:
                return 1
        if args.once:
            return 0
        time.sleep(20)


if __name__ == "__main__":
    sys.exit(main())
