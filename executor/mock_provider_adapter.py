"""Read-only, offline adapter for SYNTHETIC provider fixtures.

This is NOT an authenticated My Keep, Hirsch or Onyx integration. It accepts
only explicitly marked synthetic exports from a dedicated test directory.
No network, patient data, credentials, file copies or publication.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from source_preflight import PreflightError, _hash, _local_file

PROVIDERS = ("MyKeep", "HirschDynamics", "OnyxCeph")
MODES = ("guide", "full_presentation")
TOKEN = re.compile(r"SYNTHETIC-[A-Za-z0-9_-]{1,80}\Z")
MAX_EXPORT_BYTES = 128 * 1024
CAPTURE_FIELDS = {"path", "phase", "view", "contacts_off", "orientation_ref", "scale_ref"}
SOURCE_FIELDS = {"path", "kind"}
EXPORT_FIELDS = {
    "schema_version", "synthetic_only", "case_token", "plan_id",
    "provider", "captures", "sources",
}


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise PreflightError("Metadados duplicados no ensaio")
        result[key] = value
    return result


def _test_root(root: Path) -> Path:
    """Require a dedicated non-live fixture directory (no Dropbox/patient paths)."""
    root = Path(root)
    if (not root.name.startswith("keep-mock-")
            or any(part.lower() in {"dropbox", "keepaligner", "patients", "pacientes"}
                   for part in root.parts)
            or root.is_symlink()):
        raise PreflightError("Ensaio permitido apenas numa pasta fictícia isolada")
    try:
        root = root.resolve(strict=True)
        if not root.is_dir():
            raise PreflightError("Pasta de ensaio indisponível")
    except OSError as exc:
        raise PreflightError("Pasta de ensaio indisponível") from exc
    return root


def _read_export(root: Path, provider: str) -> dict:
    if provider not in PROVIDERS:
        raise PreflightError("Fornecedor fictício não autorizado")
    path = _local_file(root, "exports/" + provider + ".json")
    if path.stat().st_size > MAX_EXPORT_BYTES:
        raise PreflightError("Metadados do ensaio demasiado grandes")
    try:
        metadata = json.loads(path.read_text(encoding="utf-8-sig"),
                              object_pairs_hook=_unique_object)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise PreflightError("Metadados do ensaio ilegíveis") from exc
    if (not isinstance(metadata, dict) or set(metadata) != EXPORT_FIELDS
            or type(metadata.get("schema_version")) is not int
            or metadata["schema_version"] != 1
            or metadata.get("synthetic_only") is not True
            or metadata.get("provider") != provider
            or not isinstance(metadata.get("case_token"), str)
            or not TOKEN.fullmatch(metadata["case_token"])
            or not isinstance(metadata.get("plan_id"), str)
            or not TOKEN.fullmatch(metadata["plan_id"])
            or not isinstance(metadata.get("captures"), list)
            or not isinstance(metadata.get("sources"), list)):
        raise PreflightError("Exportação não é um ensaio fictício válido")
    if len(metadata["captures"]) > 8 or len(metadata["sources"]) > 3:
        raise PreflightError("Número de entradas fictícias inválido")
    return metadata


def _normalize(root: Path, provider: str, records: list,
               expected_fields: set[str], image_kind: str) -> list[dict]:
    normalized = []
    for entry in records:
        if not isinstance(entry, dict) or set(entry) != expected_fields:
            raise PreflightError("Campos de fonte fictícia inválidos")
        path = _local_file(root, entry["path"])
        if image_kind == "capture" and path.suffix.lower() != ".png":
            raise PreflightError("Captura fictícia deve ser PNG")
        if image_kind == "source":
            if entry["kind"] not in ("ipr_csv", "attachments_csv", "movement_table"):
                raise PreflightError("Tipo de fonte fictícia desconhecido")
            expected_ext = ".png" if entry["kind"] == "movement_table" else ".csv"
            if path.suffix.lower() != expected_ext:
                raise PreflightError("Tipo de fonte fictícia incompatível")
        normalized.append({**entry, "provider": provider, "sha256": _hash(path)})
    return normalized


def build_mock_manifest(root: Path, providers: tuple[str, ...],
                        package_type: str) -> dict:
    """Return normalized synthetic evidence only; NEVER write any file."""
    root = _test_root(root)
    if (package_type not in MODES or not providers or len(providers) > 3
            or len(set(providers)) != len(providers)
            or any(name not in PROVIDERS for name in providers)):
        raise PreflightError("Parâmetros de ensaio inválidos")
    captures, sources = [], []
    case = plan = None
    for provider in providers:
        export = _read_export(root, provider)
        if case is None:
            case, plan = export["case_token"], export["plan_id"]
        if export["case_token"] != case or export["plan_id"] != plan:
            raise PreflightError("Identidade ou versão fictícia incompatível")
        if provider != "OnyxCeph" and export["sources"]:
            raise PreflightError("As fontes tabulares fictícias exigem OnyxCeph")
        if provider == "OnyxCeph" and export["captures"]:
            raise PreflightError("Capturas fictícias inesperadas no OnyxCeph")
        captures.extend({**item, "plan_id": plan} for item in
                        _normalize(root, provider, export["captures"],
                                   CAPTURE_FIELDS, "capture"))
        sources.extend({**item, "plan_id": plan} for item in
                       _normalize(root, provider, export["sources"],
                                  SOURCE_FIELDS, "source"))
    return {"schema_version": 1, "plan_id": plan,
            "package_type": package_type, "captures": captures, "sources": sources}


def main() -> int:
    parser = argparse.ArgumentParser(description="Pré-visualização fictícia, apenas leitura")
    parser.add_argument("--mock-root", required=True, type=Path)
    parser.add_argument("--provider", action="append", required=True, choices=PROVIDERS)
    parser.add_argument("--package-type", required=True, choices=MODES)
    args = parser.parse_args()
    try:
        manifest = build_mock_manifest(args.mock_root, tuple(args.provider),
                                       args.package_type)
        # Never print paths, identities, plan IDs, or patient contents.
        print(json.dumps({"status": "synthetic_preview_only",
                          "captures": len(manifest["captures"]),
                          "sources": len(manifest["sources"]),
                          "writesPerformed": False,
                          "clinicalApproval": False,
                          "publishingAuthorized": False}))
        return 0
    except (PreflightError, OSError, TypeError, ValueError):
        print(json.dumps({"status": "blocked", "writesPerformed": False,
                          "clinicalApproval": False, "publishingAuthorized": False}))
        return 2


if __name__ == "__main__":
    sys.exit(main())