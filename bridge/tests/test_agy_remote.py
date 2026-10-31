#!/usr/bin/env python3
"""Hermetic tests for bounded experimental Codespaces Remote Control lifecycle."""
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout

SOURCE = Path(__file__).resolve().parents[2] / ".devcontainer" / "agy-remote.py"
spec = importlib.util.spec_from_file_location("test_remote_runner", SOURCE)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RemoteRunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = runner.STATE, runner.PID_FILE, runner.LOG_FILE, runner.LOCK_FILE
        runner.STATE = Path(self.temp.name)
        runner.PID_FILE = runner.STATE / "remote.pid"
        runner.LOG_FILE = runner.STATE / "remote.log"
        runner.LOCK_FILE = runner.STATE / "start.lock"

    def tearDown(self):
        runner.STATE, runner.PID_FILE, runner.LOG_FILE, runner.LOCK_FILE = self.old
        self.temp.cleanup()

    def test_stale_pid_is_ignored(self):
        runner.PID_FILE.write_text("222222")
        with patch.object(runner, "is_runner", return_value=False):
            self.assertIsNone(runner.running_pid())

    def test_live_pid_is_recognized(self):
        runner.PID_FILE.write_text("22222")
        with patch.object(runner, "is_runner", return_value=True):
            self.assertEqual(runner.running_pid(), 22222)

    def test_invalid_pid_is_ignored(self):
        runner.PID_FILE.write_text("invalid")
        self.assertIsNone(runner.running_pid())

    def test_restart_is_bounded(self):
        with patch.object(runner, "run_session", return_value=1) as run, \
             patch.dict(os.environ, {"AGY_BIN": "/fake/agy"}), \
             patch.object(runner, "RESTART_DELAYS", (0, 0)), \
             redirect_stdout(io.StringIO()) as output:
            self.assertEqual(runner.serve(), 0)
            self.assertEqual(run.call_count, 3)
            self.assertIn("restart budget exhausted", output.getvalue())

    def test_serve_does_not_restart_on_stop(self):
        def stop_after_one(_agy, event, _state):
            event.set()
            return 0
        with patch.object(runner, "run_session", side_effect=stop_after_one) as run, \
             patch.dict(os.environ, {"AGY_BIN": "/fake/agy"}), \
             redirect_stdout(io.StringIO()):
            self.assertEqual(runner.serve(), 0)
            self.assertEqual(run.call_count, 1)

    def test_status_does_not_expose_cli_logs(self):
        with patch.object(runner, "running_pid", return_value=None), \
             redirect_stdout(io.StringIO()) as output:
            runner.status()
            self.assertIn("runner not running", output.getvalue())


if __name__ == "__main__":
    unittest.main()
