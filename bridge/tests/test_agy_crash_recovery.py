#!/usr/bin/env python3
"""Hermetic real-process crash recovery test for experimental PTY runner.

Runs only a disposable fake CLI in the CI process environment, never the
user's real Antigravity CLI, Google account, or live Codespace.
"""
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

SOURCE = Path(__file__).resolve().parents[2] / ".devcontainer" / "agy-remote.py"


def observed_pids(path):
    try:
        return [int(item) for item in path.read_text().splitlines() if item.strip()]
    except FileNotFoundError:
        return []


def wait_for_count(path, count, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        pids = observed_pids(path)
        if len(pids) >= count:
            return pids
        time.sleep(0.05)
    raise AssertionError(f"Expected {count} fake CLI starts, observed {observed_pids(path)}")


class CrashRecoveryIntegration(unittest.TestCase):
    def test_sigkill_restarts_child_but_not_supervisor(self):
        with tempfile.TemporaryDirectory(prefix="agy-recovery-ci-") as tmp:
            home = Path(tmp)
            fake = home / "fake_agy"
            pids = home / "child-pids.txt"
            fake.write_text(
                "#!/usr/bin/env python3\n"
                "import os, time\n"
                "with open(os.environ['FAKE_AGY_PIDFILE'], 'a') as f:\n"
                "    f.write(str(os.getpid()) + '\\n')\n"
                "    f.flush()\n"
                "while True:\n"
                "    time.sleep(0.1)\n"
            )
            fake.chmod(0o700)
            env = dict(os.environ, HOME=str(home), AGY_BIN=str(fake),
                       FAKE_AGY_PIDFILE=str(pids))
            parent = subprocess.Popen(
                [sys.executable, str(SOURCE), "serve"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=env,
                start_new_session=True,
            )
            try:
                first = wait_for_count(pids, 1, timeout=8)[0]
                self.assertIsNone(parent.poll(), "runner died before crash injection")
                os.kill(first, signal.SIGKILL)
                current = wait_for_count(pids, 2, timeout=12)
                self.assertNotEqual(first, current[1], "child PID must change")
                self.assertIsNone(parent.poll(), "supervisor must survive CLI SIGKILL")
            finally:
                if parent.poll() is None:
                    parent.terminate()
                try:
                    parent.communicate(timeout=6)
                except subprocess.TimeoutExpired:
                    parent.kill()
                    parent.communicate(timeout=4)


if __name__ == "__main__":
    unittest.main()
