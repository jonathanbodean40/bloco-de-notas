"""Synthetic receipt fixtures. These unit tests do not claim actual PowerPoint rendering."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "executor"))
from output_validation import verify_outputs
from source_preflight import _hash, PreflightError


class OutputValidationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="keep-mock-output-")
        self.root = Path(self.tmp.name)
        self.jobs = self.root / "jobs"
        self.job = self.jobs / "SYNTHETIC-CASE-SYNTHETIC-V1"
        self.job.mkdir(parents=True)
        self.case = self.root / "case.json"
        self.request = {"reference": "SYNTHETIC-CASE", "version": "SYNTHETIC-V1", "mode": "guide"}
        self.write(self.case, {"case_id": self.request["reference"], "plan_id": self.request["version"]})
        with ZipFile(self.job / "GUIA.pptx", "w") as archive:
            for name in ("[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/slides/slide1.xml", "ppt/slides/slide2.xml"):
                archive.writestr(name, "<synthetic/>")
        for i in (1, 2):
            Image.new("RGB", (640, 480), (i * 30, 80, 120)).save(self.job / f"guide-{i}.png")
        self.write(self.job / "guide-native.json", {
            "slides": 2, "nativePowerPoint": True, "overflows": [],
            "exports": [str(self.job / f"guide-{i}.png") for i in (1, 2)]})
        self.write(self.job / "guide-validation.json", {"ok": True, "errors": []})
        (self.job / "PREVIA.html").write_text("SYNTHETIC TEST ONLY", encoding="utf-8")
        self.receipt = {"case_id": self.request["reference"], "plan_id": self.request["version"],
            "mode": "guide", "case_file": str(self.case), "case_file_sha256": _hash(self.case),
            "status": "awaiting_visual_review", "publication_authorized": False,
            "visual_review_complete": False, "native_rendered": True,
            "outputs": {name: _hash(self.job / name) for name in
                        ("GUIA.pptx", "guide-1.png", "guide-2.png", "guide-native.json")}}
        self.save()
        self.stdout = json.dumps({"job": str(self.job)})

    @staticmethod
    def write(path, value):
        path.write_text(json.dumps(value), encoding="utf-8")

    def save(self):
        self.write(self.job / "receipt.json", self.receipt)

    def check(self):
        return verify_outputs(self.stdout, self.jobs, self.case, self.request)

    def tearDown(self):
        self.tmp.cleanup()

    def test_fixture_is_technical_only_and_never_clinical_approval(self):
        report = self.check()
        self.assertTrue(report["verified"])
        self.assertEqual(len(report["files"]), 4)
        self.assertFalse(report["clinicalApproval"])
        self.assertFalse(report["publishingAuthorized"])
        self.assertTrue(report["requiresClinicalReview"])

    def test_empty_stdout_rejected(self):
        self.stdout = ""
        with self.assertRaises(ValueError): self.check()

    def test_foreign_job_path_rejected(self):
        self.stdout = json.dumps({"job": str(self.root)})
        with self.assertRaises(PreflightError): self.check()

    def test_wrong_identity_rejected(self):
        self.receipt["case_id"] = "OTHER"
        self.save()
        with self.assertRaises(PreflightError): self.check()

    def test_wrong_version_rejected(self):
        self.receipt["plan_id"] = "OTHER"
        self.save()
        with self.assertRaises(PreflightError): self.check()

    def test_changed_input_rejected(self):
        self.case.write_text('{"case_id":"CHANGED"}', encoding="utf-8")
        with self.assertRaises(PreflightError): self.check()

    def test_no_native_render_rejected(self):
        self.receipt["native_rendered"] = False
        self.save()
        with self.assertRaises(PreflightError): self.check()

    def test_publishing_flag_rejected(self):
        self.receipt["publication_authorized"] = True
        self.save()
        with self.assertRaises(PreflightError): self.check()

    def test_premature_review_rejected(self):
        self.receipt["visual_review_complete"] = True
        self.save()
        with self.assertRaises(PreflightError): self.check()

    def test_missing_output_rejected(self):
        del self.receipt["outputs"]["guide-2.png"]
        self.save()
        with self.assertRaises(PreflightError): self.check()

    def test_tampered_output_rejected(self):
        (self.job / "GUIA.pptx").write_bytes(b"changed")
        with self.assertRaises(PreflightError): self.check()

    def test_unexpected_output_rejected(self):
        self.receipt["outputs"]["unexpected.exe"] = "a" * 64
        self.save()
        with self.assertRaises(PreflightError): self.check()

    def test_failed_qa_rejected(self):
        self.write(self.job / "guide-validation.json", {"ok": False, "errors": ["synthetic"]})
        with self.assertRaises(PreflightError): self.check()

    def test_native_overflow_rejected_even_with_updated_hash(self):
        native = self.job / "guide-native.json"
        self.write(native, {"nativePowerPoint": True, "slides": 2, "overflows": ["synthetic"], "exports": []})
        self.receipt["outputs"][native.name] = _hash(native)
        self.save()
        with self.assertRaises(PreflightError): self.check()

    def set_exports(self, exports):
        native = self.job / "guide-native.json"
        self.write(native, {"nativePowerPoint": True, "slides": 2, "overflows": [], "exports": exports})
        self.receipt["outputs"][native.name] = _hash(native)
        self.save()

    def test_absolute_aliases_resolve_to_same_verified_exports(self):
        self.set_exports([str(self.job) + "/./guide-" + str(i) + ".png" for i in (1, 2)])
        self.assertTrue(self.check()["verified"])

    def test_relative_native_exports_rejected(self):
        self.set_exports(["guide-1.png", "guide-2.png"])
        with self.assertRaises(PreflightError): self.check()

    def test_wrong_native_export_order_rejected(self):
        self.set_exports([str(self.job / f"guide-{i}.png") for i in (2, 1)])
        with self.assertRaises(PreflightError): self.check()

    def test_native_exports_must_be_a_list(self):
        self.set_exports({"first": str(self.job / "guide-1.png")})
        with self.assertRaises(PreflightError): self.check()

    def test_missing_preview_rejected(self):
        (self.job / "PREVIA.html").unlink()
        with self.assertRaises(PreflightError): self.check()

    def test_duplicate_receipt_keys_rejected(self):
        (self.job / "receipt.json").write_text('{"mode":"guide","mode":"presentation"}', encoding="utf-8")
        with self.assertRaises(PreflightError): self.check()


if __name__ == "__main__":
    unittest.main()
