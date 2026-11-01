"""Synthetic cross-module workflow tests. No live agent, patient files or generator."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "executor"))
import agent
from mock_provider_adapter import build_mock_manifest
from source_preflight import inspect_manifest


class SyntheticPipelineTests(unittest.TestCase):
    """Each test confines file I/O to a disposable keep-mock-* directory."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="keep-mock-pipeline-")
        self.root = Path(self.temp.name)
        self.cases = self.root / "cases"
        self.reference = "keep-mock-CASE01"
        self.staged = self.cases / self.reference
        self.assets = self.staged / "assets"
        self.exports = self.staged / "exports"
        self.assets.mkdir(parents=True)
        self.exports.mkdir()
        self.request = {
            "reference": self.reference, "mode": "presentation",
            "version": "SYNTHETIC-V1", "status": "unknown",
            "kind": "unknown", "notes": "SYNTHETIC TEST"
        }
        self.providers = {}
        for name in ("MyKeep", "HirschDynamics", "OnyxCeph"):
            self.providers[name] = {
                "schema_version": 1, "synthetic_only": True,
                "case_token": "SYNTHETIC-CASE01",
                "plan_id": "SYNTHETIC-V1",
                "provider": name, "captures": [], "sources": []
            }
        for phase in ("initial", "final"):
            for view in ("front", "lateral", "upper", "lower"):
                path = "assets/" + phase + "-" + view + ".png"
                Image.new("RGB", (960, 540), (120, 155, 190)).save(
                    self.staged / path
                )
                self.providers["HirschDynamics"]["captures"].append({
                    "path": path, "phase": phase, "view": view,
                    "contacts_off": True, "orientation_ref": "test-" + view,
                    "scale_ref": "test-" + view
                })
        Image.new("RGB", (960, 540), (255, 255, 255)).save(
            self.assets / "movements.png"
        )
        self.providers["OnyxCeph"]["sources"].append({
            "kind": "movement_table", "path": "assets/movements.png"
        })
        self.patches = [
            patch.object(agent, "CASES", self.cases),
            patch.object(agent, "INBOX", self.root / "inbox"),
            patch.object(agent, "RESULTS", self.root / "results"),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def prepare(self, structured=True):
        for provider, value in self.providers.items():
            (self.exports / (provider + ".json")).write_text(
                json.dumps(value), encoding="utf-8"
            )
        manifest = build_mock_manifest(
            self.staged, ("MyKeep", "HirschDynamics", "OnyxCeph"),
            "full_presentation"
        )
        (self.staged / "manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )
        if structured:
            (self.cases / (self.reference + ".json")).write_text(
                json.dumps({"synthetic_only": True}), encoding="utf-8"
            )
        return manifest

    def request_file(self):
        ticket = "a" * 32
        path = agent.INBOX / (ticket + ".json")
        agent.save_json(path, {
            "id": ticket, "createdAt": "2026-11-01T00:00:00+00:00",
            "state": "queued", "request": self.request
        })
        return path

    def run_with_fake_generator(self):
        with patch.object(agent, "python_and_generator", return_value=(
                Path("synthetic-python"), Path("synthetic-generator"))), \
             patch.object(agent.subprocess, "run", return_value=subprocess.CompletedProcess(
                args=[], returncode=0, stdout="", stderr=""
             )) as fake:
            result = agent.process_job(self.request_file())
        return result, fake

    def test_cross_module_preflight_does_not_grant_clinical_approval(self):
        self.prepare()
        report = inspect_manifest(self.staged / "manifest.json")
        self.assertTrue(report["ok"], report["errors"])
        self.assertTrue(agent.staged_sources_ready(self.reference, self.request))
        self.assertFalse(report["publishingAuthorized"])
        self.assertFalse(report["clinicalDataConfirmed"])
        self.assertFalse(report["contactsVisuallyVerified"])

    def test_zero_exit_without_artifacts_is_blocked(self):
        self.prepare()
        result, fake = self.run_with_fake_generator()
        self.assertEqual(result["state"], "blocked")
        self.assertFalse(result["clinicalApproval"])
        self.assertFalse(result["publishingAuthorized"])
        fake.assert_called_once()
        args = fake.call_args.args[0]
        self.assertNotIn("--no-render", args)
        self.assertNotIn("publish", args)
        self.assertNotIn("archive-new", args)
        self.assertTrue((agent.RESULTS / ("a" * 32 + ".json")).is_file())
        self.assertFalse((agent.INBOX / ("a" * 32 + ".json")).exists())

    def test_native_rollout_blocks_non_synthetic_case(self):
        self.prepare()
        for marker in (False, None, "true", 1):
            with self.subTest(marker=marker):
                (self.cases / (self.reference + ".json")).write_text(
                    json.dumps({"synthetic_only": marker}), encoding="utf-8")
                result, fake = self.run_with_fake_generator()
                self.assertEqual(result["state"], "awaiting_integration_validation")
                self.assertFalse(result["clinicalApproval"])
                self.assertFalse(result["publishingAuthorized"])
                fake.assert_not_called()

    def test_wrong_request_version_stops_before_generator(self):
        self.prepare()
        self.request["version"] = "SYNTHETIC-OLD"
        result, fake = self.run_with_fake_generator()
        self.assertEqual(result["state"], "awaiting_verified_sources")
        fake.assert_not_called()

    def test_changed_capture_stops_before_generator(self):
        self.prepare()
        (self.assets / "initial-front.png").write_bytes(b"synthetic-changed")
        result, fake = self.run_with_fake_generator()
        self.assertEqual(result["state"], "awaiting_verified_sources")
        fake.assert_not_called()

    def test_missing_case_file_stops_before_generator(self):
        self.prepare(structured=False)
        result, fake = self.run_with_fake_generator()
        self.assertEqual(result["state"], "awaiting_case_data")
        fake.assert_not_called()

    def test_unverified_contact_declaration_stops_before_generator(self):
        manifest = self.prepare()
        manifest["captures"][0]["contacts_off"] = False
        (self.staged / "manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )
        result, fake = self.run_with_fake_generator()
        self.assertEqual(result["state"], "awaiting_verified_sources")
        fake.assert_not_called()

    def test_wrong_package_mode_stops_before_generator(self):
        self.prepare()
        self.request["mode"] = "guide"
        result, fake = self.run_with_fake_generator()
        self.assertEqual(result["state"], "awaiting_verified_sources")
        fake.assert_not_called()


if __name__ == "__main__":
    unittest.main()