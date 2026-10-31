#!/usr/bin/env python3
"""Safety preflight tests: no real process is ever signalled."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "test_remote_crash.py"
spec = importlib.util.spec_from_file_location("agy_crash_guard", SOURCE)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

class CrashSafetyTests(unittest.TestCase):
    def test_reject_wrong_environment(self):
        with patch.dict(os.environ, {"CODESPACE_NAME": "golden-meteor-123456"}, clear=False):
            with self.assertRaisesRegex(ValueError, "not_test_codespace"):
                guard.test_guard()

    def test_match_direct_cli_process_only(self):
        with patch.object(guard, "commands", return_value=["/home/user/.local/bin/agy", "--remote-control"]):
            self.assertTrue(guard.remote_child(9999))

    def test_match_interpreted_cli_process_only(self):
        with patch.object(guard, "commands", return_value=["/usr/bin/node", "/home/user/.local/bin/agy", "--remote-control"]):
            self.assertTrue(guard.remote_child(9999))

    def test_reject_other_process(self):
        with patch.object(guard, "commands", return_value=["/usr/bin/bash", "unrelated.sh", "--remote-control"]):
            self.assertFalse(guard.remote_child(9999))

    def test_no_inject_without_approval_flag(self):
        with patch.object(guard, "test_guard", return_value=(101, 102, object())), \
             patch.dict(os.environ, {"AGY_TEST_CRASH_APPROVED": "0"}), \
             patch.object(guard.signal, "pidfd_send_signal") as sig, \
             patch.object(sys, "argv", ["test_remote_crash.py", "inject"]), \
             contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(guard.main(), 1)
            self.assertIn("explicit_test_authorization_missing", out.getvalue())
            sig.assert_not_called()

if __name__ == "__main__":
    unittest.main()
