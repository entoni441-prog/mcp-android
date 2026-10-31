#!/usr/bin/env python3
"""Hermetic offline tests for CLI cosmetic settings, no Codespaces or network."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[1] / "config_control.py"
spec = importlib.util.spec_from_file_location("agy_config_control_tested", MODULE)
cfg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cfg)

class ConfigControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name) / ".gemini" / "antigravity-cli"
        self.folder.mkdir(parents=True, mode=0o700)
        self.before = (cfg.CONFIG, cfg.JOURNAL, cfg.LOCK)
        cfg.CONFIG = self.folder / "settings.json"
        cfg.JOURNAL = self.folder / ".agy-bridge-rollback.json"
        cfg.LOCK = self.folder / ".agy-config-control.lock"

    def tearDown(self):
        cfg.CONFIG, cfg.JOURNAL, cfg.LOCK = self.before
        self.temp.cleanup()

    def operation(self, fn, *args):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            fn(*args)
        result = json.loads(output.getvalue())
        self.assertIsInstance(result, dict)
        return result

    def original(self):
        # A deliberately confidential, non-allowlisted setting must never be echoed.
        blob = b'{"verbosity":"medium","externalSecret":"NO-OUTPUT-SECRET","other":123}\n'
        cfg.CONFIG.write_bytes(blob)
        return blob

    def test_inspect_redacts_unknown_fields(self):
        self.original()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            cfg.inspect()
        self.assertNotIn("NO-OUTPUT-SECRET", output.getvalue())
        data = json.loads(output.getvalue())
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["preferences"]["verbosity"], "medium")
        self.assertEqual(set(data["preferences"]), set(cfg.ALLOWED))

    def test_successful_apply_and_exact_byte_rollback(self):
        raw = self.original()
        baseline = hashlib.sha256(raw).hexdigest()
        plan = self.operation(cfg.plan, "verbosity", "low")
        self.assertEqual(plan["expected_sha256"], baseline)
        applied = self.operation(cfg.apply, "verbosity", "low", baseline)
        self.assertEqual(applied["status"], "updated")
        self.assertTrue(applied["rollback_available"])
        self.assertNotIn("NO-OUTPUT-SECRET", json.dumps(applied))
        self.assertEqual(cfg.CONFIG.stat().st_mode & 0o077, 0)
        self.assertEqual(cfg.JOURNAL.stat().st_mode & 0o077, 0)
        restored = self.operation(cfg.rollback, applied["sha256"])
        self.assertEqual(restored["status"], "rolled_back")
        self.assertFalse(restored["recovered_incomplete_apply"])
        self.assertEqual(restored["sha256"], baseline)
        self.assertEqual(cfg.CONFIG.read_bytes(), raw)

    def test_missing_file_apply_rollback_removes_created_config(self):
        self.assertFalse(cfg.CONFIG.exists())
        plan = self.operation(cfg.plan, "verbosity", "low")
        self.assertEqual(plan["expected_sha256"], "missing")
        applied = self.operation(cfg.apply, "verbosity", "low", "missing")
        self.assertTrue(cfg.CONFIG.exists())
        self.operation(cfg.rollback, applied["sha256"])
        self.assertFalse(cfg.CONFIG.exists())

    def test_stale_sha_refuses_mutation(self):
        raw = self.original()
        with self.assertRaisesRegex(RuntimeError, "settings_changed_since_plan"):
            cfg.apply("verbosity", "low", "f" * 64)
        self.assertEqual(cfg.CONFIG.read_bytes(), raw)

    def test_rejects_nonallowlisted_and_unsafe_options(self):
        raw = self.original()
        digest = hashlib.sha256(raw).hexdigest()
        with self.assertRaisesRegex(RuntimeError, "setting_not_allowlisted"):
            cfg.apply("agentMode", "turbo", digest)
        with self.assertRaisesRegex(RuntimeError, "setting_not_allowlisted"):
            cfg.apply("verbosity", "sudo", digest)
        self.assertEqual(cfg.CONFIG.read_bytes(), raw)

    def test_prevent_second_write_with_pending_rollback(self):
        raw = self.original()
        first = self.operation(cfg.apply, "verbosity", "low", hashlib.sha256(raw).hexdigest())
        with self.assertRaisesRegex(RuntimeError, "previous_rollback_pending"):
            cfg.apply("colorScheme", "dark", first["sha256"])
        self.operation(cfg.rollback, first["sha256"])

    def test_rollback_refuses_external_changes(self):
        raw = self.original()
        first = self.operation(cfg.apply, "verbosity", "low", hashlib.sha256(raw).hexdigest())
        cfg.CONFIG.write_text('{"other":"modified"}', encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "settings_changed_since_apply"):
            cfg.rollback(first["sha256"])
        self.assertEqual(cfg.CONFIG.read_text(), '{"other":"modified"}')

    def test_recover_crash_before_settings_replace(self):
        raw = self.original()
        first = self.operation(cfg.apply, "verbosity", "low", hashlib.sha256(raw).hexdigest())
        # Simulates journal written but config replacement interrupted.
        cfg.CONFIG.write_bytes(raw)
        result = self.operation(cfg.rollback, first["sha256"])
        self.assertEqual(result["status"], "rolled_back")
        self.assertTrue(result["recovered_incomplete_apply"])
        self.assertEqual(cfg.CONFIG.read_bytes(), raw)
        self.assertEqual(cfg.journal()["state"], "rolled_back")

    def test_symlink_refused(self):
        self.original()
        with tempfile.NamedTemporaryFile() as destination:
            cfg.CONFIG.unlink()
            cfg.CONFIG.symlink_to(destination.name)
            with self.assertRaisesRegex(RuntimeError, "symlink_refused"):
                cfg.inspect()

if __name__ == "__main__":
    unittest.main()
