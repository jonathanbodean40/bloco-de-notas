"""Offline synthetic-only contract tests. No live sources or queues."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "executor"))
from mock_provider_adapter import build_mock_manifest, PreflightError
from source_preflight import inspect_manifest


class MockProviderAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="keep-mock-")
        self.root = Path(self.tmp.name)
        (self.root / "exports").mkdir()
        (self.root / "assets").mkdir()
        self.mock = {}
        for provider in ("MyKeep", "HirschDynamics", "OnyxCeph"):
            self.mock[provider] = {
                "schema_version": 1, "synthetic_only": True,
                "case_token": "SYNTHETIC-CASE01", "plan_id": "SYNTHETIC-V1",
                "provider": provider, "sources": [], "captures": []
            }
        for phase in ("initial", "final"):
            for view in ("front", "lateral", "upper", "lower"):
                name = phase + "-" + view + ".png"
                Image.new("RGB", (960, 540), (100, 140, 190)).save(self.root / "assets" / name)
                self.mock["HirschDynamics"]["captures"].append({
                    "path": "assets/" + name, "phase": phase, "view": view,
                    "contacts_off": True, "orientation_ref": "fixture-" + view,
                    "scale_ref": "fixture-" + view,
                })
        Image.new("RGB", (960, 540), (255, 255, 255)).save(self.root / "assets" / "movement.png")
        self.mock["OnyxCeph"]["sources"].append({
            "kind": "movement_table", "path": "assets/movement.png"
        })
        self._save()

    def tearDown(self):
        self.tmp.cleanup()

    def _save(self):
        for provider, payload in self.mock.items():
            (self.root / "exports" / (provider + ".json")).write_text(
                json.dumps(payload), encoding="utf-8")

    def _build(self, providers=("MyKeep", "HirschDynamics", "OnyxCeph")):
        self._save()
        return build_mock_manifest(self.root, providers, "full_presentation")

    def test_three_provider_preview_passes_existing_preflight(self):
        before = set(self.root.rglob("*"))
        manifest = self._build()
        after = set(self.root.rglob("*"))
        self.assertEqual(before, after, "Adapter must be read-only")
        self.assertEqual(len(manifest["captures"]), 8)
        self.assertEqual(len(manifest["sources"]), 1)
        (self.root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        result = inspect_manifest(self.root / "manifest.json")
        self.assertTrue(result["ok"], result["errors"])
        self.assertFalse(result["publishingAuthorized"])
        self.assertFalse(result["clinicalDataConfirmed"])

    def test_mismatched_version_rejected(self):
        self.mock["OnyxCeph"]["plan_id"] = "SYNTHETIC-OLD"
        with self.assertRaises(PreflightError):
            self._build()

    def test_mismatched_case_rejected(self):
        self.mock["MyKeep"]["case_token"] = "SYNTHETIC-OTHER"
        with self.assertRaises(PreflightError):
            self._build()

    def test_real_data_marker_rejected(self):
        self.mock["HirschDynamics"]["synthetic_only"] = False
        with self.assertRaises(PreflightError):
            self._build()

    def test_non_synthetic_case_rejected(self):
        self.mock["OnyxCeph"]["case_token"] = "patient-name"
        with self.assertRaises(PreflightError):
            self._build()

    def test_unknown_provider_rejected(self):
        with self.assertRaises(PreflightError):
            self._build(("OtherProvider",))

    def test_path_traversal_rejected(self):
        self.mock["HirschDynamics"]["captures"][0]["path"] = "../outside.png"
        with self.assertRaises(PreflightError):
            self._build()

    def test_unknown_fields_rejected(self):
        self.mock["MyKeep"]["authorization_token"] = "should-never-appear"
        with self.assertRaises(PreflightError):
            self._build()

    def test_no_live_directory_allowed(self):
        with self.assertRaises(PreflightError):
            build_mock_manifest(Path.home() / "Dropbox", ("OnyxCeph",), "guide")

    def test_duplicated_provider_rejected(self):
        with self.assertRaises(PreflightError):
            self._build(("MyKeep", "MyKeep"))

    def test_wrong_file_type_rejected(self):
        self.mock["OnyxCeph"]["sources"][0]["path"] = "assets/initial-front.png"
        self.mock["OnyxCeph"]["sources"][0]["kind"] = "ipr_csv"
        with self.assertRaises(PreflightError):
            self._build()

    def test_invalid_mode_rejected(self):
        with self.assertRaises(PreflightError):
            build_mock_manifest(self.root, ("OnyxCeph",), "publish")

    def test_csv_can_be_included_in_guide(self):
        (self.root / "assets" / "ipr.csv").write_text("etapa,FDI,mm\n", encoding="utf-8")
        self.mock["OnyxCeph"]["sources"].append({
            "kind": "ipr_csv", "path": "assets/ipr.csv"})
        self._save()
        manifest = build_mock_manifest(self.root, ("OnyxCeph",), "guide")
        self.assertEqual(len(manifest["sources"]), 2)
        self.assertEqual(manifest["captures"], [])


if __name__ == "__main__":
    unittest.main()