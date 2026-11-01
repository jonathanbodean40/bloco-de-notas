"""Only synthetic staged data; never open an installed worker queue."""
import hashlib
import json
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "executor"))
import agent


class SourceGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="keep-source-gate-test-")
        self.root = Path(self.tmp.name)
        self.prior = agent.CASES, agent.INBOX, agent.RESULTS
        agent.CASES = self.root / "cases"
        agent.INBOX = self.root / "inbox"
        agent.RESULTS = self.root / "results"
        for folder in (agent.CASES, agent.INBOX, agent.RESULTS):
            folder.mkdir()
        self.reference = "SYNTHETIC-ONLY-001"
        self.request = {"mode": "guide", "reference": self.reference,
                        "version": "SYNTHETIC-V1", "planning": "",
                        "status": "unknown", "kind": "unknown", "notes": ""}
        (agent.CASES / (self.reference + ".json")).write_text(
            "{}", encoding="utf-8"
        )
        self.stage = agent.CASES / self.reference
        self.stage.mkdir()

    def tearDown(self):
        agent.CASES, agent.INBOX, agent.RESULTS = self.prior
        self.tmp.cleanup()

    def save_manifest(self, package_type="guide", plan_id="SYNTHETIC-V1",
                      sources=True):
        records = []
        if sources:
            source = self.stage / "source.csv"
            source.write_bytes(b"tooth,step,amount\n")
            records = [{"kind": "ipr_csv", "provider": "OnyxCeph",
                        "plan_id": plan_id, "path": "source.csv",
                        "sha256": hashlib.sha256(source.read_bytes()).hexdigest()}]
        manifest = self.stage / "manifest.json"
        manifest.write_text(json.dumps(
            {"schema_version": 1, "plan_id": plan_id,
             "package_type": package_type, "sources": records, "captures": []}
        ), encoding="utf-8")
        return manifest

    def run_synthetic_job(self):
        ticket = uuid.uuid4().hex
        pending = agent.INBOX / (ticket + ".json")
        pending.write_text(json.dumps(
            {"id": ticket, "request": self.request, "createdAt": "synthetic"}
        ), encoding="utf-8")
        with patch.object(agent, "python_and_generator",
                          side_effect=AssertionError("generator must not start")) as invoked:
            result = agent.process_job(pending)
            invoked.assert_not_called()
        return result

    def test_missing_manifest_blocks_generator(self):
        outcome = self.run_synthetic_job()
        self.assertEqual(outcome["state"], "awaiting_verified_sources")
        self.assertTrue((agent.RESULTS / (outcome["id"] + ".json")).is_file())

    def test_correct_staged_guide_is_only_preflight_ready(self):
        self.save_manifest()
        self.assertTrue(agent.staged_sources_ready(self.reference, self.request))

    def test_wrong_plan_version_is_rejected(self):
        self.save_manifest(plan_id="SYNTHETIC-OLD")
        self.assertFalse(agent.staged_sources_ready(self.reference, self.request))

    def test_missing_request_version_is_rejected(self):
        self.save_manifest()
        self.request["version"] = ""
        self.assertFalse(agent.staged_sources_ready(self.reference, self.request))

    def test_package_type_mismatch_is_rejected(self):
        self.save_manifest(package_type="refinement_simple")
        self.assertFalse(agent.staged_sources_ready(self.reference, self.request))

    def test_empty_guide_evidence_is_rejected(self):
        self.save_manifest(sources=False)
        self.assertFalse(agent.staged_sources_ready(self.reference, self.request))

    def test_changed_export_blocks_generator(self):
        self.save_manifest()
        (self.stage / "source.csv").write_text("altered", encoding="utf-8")
        outcome = self.run_synthetic_job()
        self.assertEqual(outcome["state"], "awaiting_verified_sources")

    def test_manifest_symlink_not_accepted(self):
        manifest = self.save_manifest()
        alternate = agent.CASES / "alternate.json"
        manifest.rename(alternate)
        try:
            manifest.symlink_to(alternate)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable on this Windows account")
        self.assertFalse(agent.staged_sources_ready(self.reference, self.request))


if __name__ == "__main__":
    unittest.main()
