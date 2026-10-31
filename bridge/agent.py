#!/usr/bin/env python3
"""Ed25519-signed, fixed-probe Codespaces agent. Private key never leaves Codespaces."""
import argparse
import base64
import hashlib
import secrets
import tempfile
from pathlib import Path
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


PRIVATE_DIR=Path.home()/".config"/"agy-bridge"
PRIVATE_FILE=PRIVATE_DIR/"identity.pem"

def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")

def keypair():
    if not PRIVATE_FILE.exists():
        PRIVATE_DIR.mkdir(mode=0o700,parents=True,exist_ok=True)
        os.chmod(PRIVATE_DIR,0o700)
        fd,tmp=tempfile.mkstemp(dir=PRIVATE_DIR,prefix=".identity-")
        os.close(fd)
        try:
            subprocess.run(["openssl","genpkey","-algorithm","Ed25519","-out",tmp],check=True,capture_output=True,timeout=15)
            os.chmod(tmp,0o600)
            os.replace(tmp,PRIVATE_FILE)
        finally:
            if os.path.exists(tmp): os.unlink(tmp)
    os.chmod(PRIVATE_FILE,0o600)
    p=subprocess.run(["openssl","pkey","-in",str(PRIVATE_FILE),"-pubout","-outform","DER"],check=True,capture_output=True,timeout=15).stdout
    return p,hashlib.sha256(p).hexdigest()

def signature(message):
    with tempfile.TemporaryDirectory() as d:
        file=Path(d)/"msg"
        file.write_bytes(message)
        return subprocess.run(["openssl","pkeyutl","-sign","-rawin","-inkey",str(PRIVATE_FILE),"-in",str(file)],
                              check=True,capture_output=True,timeout=15).stdout

class BridgeHTTPError(Exception):
    def __init__(self, status, code):
        self.status = status
        self.code = code
        super().__init__(code)

def request_json(endpoint,path,data,agent_id=None):
    """Use curl transport: the prior urllib client received a non-JSON 403.
    Never put keys, tokens or request bodies on the command line."""
    body=json.dumps(data,separators=(",",":"),ensure_ascii=True).encode()
    headers={"Content-Type":"application/json","Accept":"application/json"}
    if agent_id:
        ts=str(int(time.time()))
        nonce=b64u(secrets.token_bytes(18))
        canonical="\n".join(["POST",path,ts,nonce,hashlib.sha256(body).hexdigest()]).encode()
        headers.update({"X-AGY-Agent-ID":agent_id,"X-AGY-Timestamp":ts,"X-AGY-Nonce":nonce,
                        "X-AGY-Signature":b64u(signature(canonical))})
    command=["curl","--silent","--show-error","--max-time","20",
             "--connect-timeout","8","--proto","=https","--request","POST"]
    for k,v in headers.items():
        command.extend(["--header",k+": "+v])
    command.extend(["--data-binary","@-","--write-out","\n%{http_code}","--url",endpoint+path])
    proc=subprocess.run(command,input=body,capture_output=True,timeout=25)
    if proc.returncode!=0:
        raise RuntimeError("curl_transport_failed")
    try:
        raw,code=proc.stdout.rsplit(b"\n",1)
        code=int(code)
    except (ValueError, TypeError):
        raise RuntimeError("invalid_http_response")
    if len(raw)>16384:
        raise RuntimeError("oversized_http_response")
    if code<200 or code>=300:
        identifier="non_json_http_error"
        try:
            error=json.loads(raw).get("error","")
            if isinstance(error,str) and re.fullmatch(r"[a-z_]{1,50}",error):
                identifier=error
        except (ValueError,AttributeError):
            pass
        raise BridgeHTTPError(code,identifier)
    try:
        response=json.loads(raw)
    except ValueError:
        raise RuntimeError("invalid_json_response")
    if not isinstance(response,dict):
        raise RuntimeError("invalid_json_object")
    return response

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
    parser=argparse.ArgumentParser()
    grp=parser.add_mutually_exclusive_group(required=True)
    grp.add_argument("--enroll",action="store_true")
    grp.add_argument("--once",action="store_true")
    grp.add_argument("--loop",action="store_true")
    args=parser.parse_args()
    endpoint=os.environ.get("AGY_BRIDGE_URL","").strip().rstrip("/")
    if not re.fullmatch(r"https://[a-zA-Z0-9.-]+",endpoint):
        print("AGY_BRIDGE_URL requires a valid HTTPS hostname",file=sys.stderr)
        return 2
    try:
        pub,agent_id=keypair()
        if args.enroll:
            response=request_json(endpoint,"/v1/agent/enroll",{"public_key":b64u(pub)})
            if response.get("agent_id")!=agent_id: raise RuntimeError("Identity mismatch")
            print("Registration:",response.get("status"))
            print("Public fingerprint:",agent_id[:16])
            return 0
        while True:
            job=request_json(endpoint,"/v1/agent/claim",{},agent_id).get("job")
            if not job: print("No queued probe jobs.")
            elif job.get("kind")=="probe" and re.fullmatch(r"[a-zA-Z0-9_-]{8,80}",job.get("id","")):
                result=execute_probe()
                ack=request_json(endpoint,"/v1/agent/jobs/"+job["id"]+"/finish",result,agent_id)
                print("Probe:",result["status"],"accepted:",ack.get("accepted"))
            else:
                raise RuntimeError("Unexpected job type")
            if not args.loop: return 0
            time.sleep(20)
    except BridgeHTTPError as exc:
        print(f"Bridge HTTP {exc.status}: {exc.code}",file=sys.stderr)
        return 1
    except subprocess.CalledProcessError:
        print("Local OpenSSL key operation failed", file=sys.stderr)
        return 1
    except (OSError, ValueError, RuntimeError, urllib.error.URLError) as exc:
        print(f"Bridge failure: {type(exc).__name__} (no secrets printed)", file=sys.stderr)
        return 1

if __name__=="__main__":
    sys.exit(main())
