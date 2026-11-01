"""Synthetic-only tests: never touch the live queue or patient folders."""
from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "executor"))
from source_preflight import inspect_manifest


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="keep-aligner-synthetic-")
        self.root = Path(self.temp.name)
        self.manifest = self.root / "manifest.json"
        self.assets = self.root / "sources"
        self.assets.mkdir()
        self.plan = "SYNTHETIC-V1"
        self.data = {"schema_version": 1, "plan_id": self.plan,
                     "package_type": "full_presentation", "sources": [], "captures": []}
        for phase in ("initial", "final"):
            for view in ("front", "lateral", "upper", "lower"):
                name = phase + "-" + view + ".png"
                Image.new("RGB", (960, 540), (120, 180, 230)).save(self.assets / name)
                self.data["captures"].append({
                    "path": "sources/" + name,
                    "sha256": self.sha(self.assets / name),
                    "provider": "HirschDynamics", "plan_id": self.plan,
                    "phase": phase, "view": view, "contacts_off": True,
                    "orientation_ref": "synthetic-orientation-" + view,
                    "scale_ref": "synthetic-scale-" + view})
        Image.new("RGB", (960, 540), (255, 255, 255)).save(self.assets / "movements.png")
        self.data["sources"].append({
            "kind": "movement_table", "provider": "OnyxCeph", "plan_id": self.plan,
            "path": "sources/movements.png", "sha256": self.sha(self.assets / "movements.png")})

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def sha(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def check(self):
        self.manifest.write_text(json.dumps(self.data), encoding="utf-8")
        return inspect_manifest(self.manifest)

    def test_valid_is_not_approval(self):
        result = self.check()
        self.assertTrue(result["ok"], result["errors"])
        self.assertEqual(result["captureCount"], 8)
        self.assertEqual(result["sourceCount"], 1)
        self.assertTrue(result["requiresVisualReview"])
        self.assertTrue(result["requiresClinicalReview"])
        for name in ("contactsVisuallyVerified", "clinicalDataConfirmed",
                     "automaticCollection", "publishingAuthorized"):
            self.assertFalse(result[name])

    def test_wrong_plan(self):
        self.data["captures"][0]["plan_id"] = "PREVIOUS-VERSION"
        self.assertFalse(self.check()["ok"])

    def test_hash_changed(self):
        (self.assets / "initial-front.png").write_bytes(b"not a real image")
        self.assertFalse(self.check()["ok"])

    def test_missing_capture(self):
        self.data["captures"].pop()
        self.assertFalse(self.check()["ok"])

    def test_contacts_not_declared_off(self):
        self.data["captures"][2]["contacts_off"] = False
        self.assertFalse(self.check()["ok"])

    def test_wrong_order(self):
        self.data["captures"][0], self.data["captures"][1] = (
            self.data["captures"][1], self.data["captures"][0])
        self.assertFalse(self.check()["ok"])

    def test_orientation_mismatch(self):
        self.data["captures"][4]["orientation_ref"] = "changed"
        self.assertFalse(self.check()["ok"])

    def test_traversal_rejected(self):
        self.data["captures"][0]["path"] = "../outside.png"
        self.assertFalse(self.check()["ok"])

    def test_refinement_without_captures(self):
        self.data.update(package_type="refinement_simple", captures=[], sources=[])
        self.assertTrue(self.check()["ok"])

    def test_guide_without_captures(self):
        self.data.update(package_type="guide", captures=[], sources=[])
        self.assertTrue(self.check()["ok"])

    def test_invalid_png(self):
        target = self.assets / "initial-front.png"
        target.write_bytes(b"invalid image")
        self.data["captures"][0]["sha256"] = self.sha(target)
        self.assertFalse(self.check()["ok"])

    def test_movement_table_required(self):
        self.data["sources"] = []
        self.assertFalse(self.check()["ok"])


if __name__ == "__main__":
    unittest.main()
