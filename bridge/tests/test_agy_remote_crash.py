#!/usr/bin/env python3
"""Real subprocess crash/recovery test with a disposable fake Antigravity CLI.

Only a synthetic child process in an isolated test directory is ever killed.
Never invokes, signals or authenticates with the actual Antigravity CLI.
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
FAKE_CLI = """#!/usr/bin/env python3
import os
import time
from pathlib import Path

# A fresh process independently appends its PID to a disposable status log.
path = Path(os.environ["AGY_FAKE_PIDS"])
with path.open("a", encoding="utf-8") as out:
    out.write(str(os.getpid()) + "\\n")
    out.flush()
while True:
    time.sleep(0.1)
"""


def read_pids(path):
    try:
        return [int(x) for x in path.read_text().split() if x.strip().isdigit()]
    except FileNotFoundError:
        return []


def until(condition, seconds, interval=0.08):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        result = condition()
        if result:
            return result
        time.sleep(interval)
    return None


class CrashRecoveryIntegrationTest(unittest.TestCase):
    def test_killed_cli_child_restarts_under_same_runner(self):
        # Exercise a real Linux PTY, real SIGKILL, and the actual recovery loop.
        with tempfile.TemporaryDirectory(prefix="agy-disposable-crash-") as base:
            directory = Path(base)
            cli = directory / "fake_agy"
            cli.write_text(FAKE_CLI)
            cli.chmod(0o700)
            pid_log = directory / "fake_child_pids.txt"
            env = {
                **os.environ,
                "AGY_BIN": str(cli),
                "AGY_FAKE_PIDS": str(pid_log),
            }
            with (directory / "runner-output.txt").open("wb") as log:
                proc = subprocess.Popen(
                    [sys.executable, str(SOURCE), "serve"],
                    env=env,
                    cwd=str(directory),
                    stdin=subprocess.DEVNULL,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
                try:
                    self.assertTrue(until(lambda: len(read_pids(pid_log)) >= 1, 10),
                                    "fake child never started")
                    first = read_pids(pid_log)[0]
                    self.assertIsNone(proc.poll(), "runner exited before injection")
                    # The PID was produced by our disposable fake, not looked up
                    # from any real runner's PID file. Do not target outside it.
                    os.kill(first, signal.SIGKILL)
                    self.assertTrue(until(lambda: len(read_pids(pid_log)) >= 2, 14),
                                    "fake CLI did not restart after SIGKILL")
                    second = read_pids(pid_log)[1]
                    self.assertNotEqual(first, second, "restart did not create new child")
                    self.assertIsNone(proc.poll(), "runner did not survive child crash")
                    proc.send_signal(signal.SIGTERM)
                    proc.wait(timeout=5)
                    self.assertEqual(proc.returncode, 0, "runner did not stop cleanly")
                    self.assertEqual(len(read_pids(pid_log)), 2,
                                     "normal shutdown incorrectly restarted child")
                finally:
                    # Only terminate this disposable process group, never the host CLI.
                    if proc.poll() is None:
                        os.killpg(proc.pid, signal.SIGKILL)
                        proc.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
