"""Offline provenance preflight for manually staged KEEP ALIGNER exports.

No provider authentication, patient-data collection, clinical generation,
uploads, copying or publication. This validates *only* local staged evidence.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath

from PIL import Image, UnidentifiedImageError

SCHEMA = 1
MAX_MANIFEST_BYTES = 128 * 1024
MAX_ASSET_BYTES = 64 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 50_000_000
VIEWS = ("front", "lateral", "upper", "lower")
PHASES = ("initial", "final")
CAPTURE_SEQUENCE = [(phase, view) for phase in PHASES for view in VIEWS]
PROVIDERS = {"MyKeep", "HirschDynamics", "OnyxCeph", "DigitalSmile"}
SOURCE_KINDS = {"ipr_csv", "attachments_csv", "movement_table"}
MANIFEST_FIELDS = {"schema_version", "plan_id", "package_type", "captures", "sources"}
SOURCE_FIELDS = {"kind", "provider", "plan_id", "path", "sha256"}
CAPTURE_FIELDS = {
    "path", "sha256", "provider", "plan_id", "phase", "view",
    "contacts_off", "orientation_ref", "scale_ref",
}
SHA = re.compile(r"[0-9a-f]{64}\Z")


class PreflightError(ValueError):
    """Errors must not expose paths, clinical data or patient identifiers."""


def _unique_keys(pairs: list[tuple[str, object]]) -> dict:
    """Reject ambiguous metadata and unexpected duplicate JSON keys."""
    result = {}
    for key, value in pairs:
        if key in result:
            raise PreflightError("Metadados repetidos no manifesto")
        result[key] = value
    return result


def _nonempty(value: object, limit: int = 160) -> bool:
    return (isinstance(value, str) and 0 < len(value.strip()) <= limit
            and all(ord(char) >= 32 for char in value))


def _local_file(root: Path, rel: object) -> Path:
    if not isinstance(rel, str) or not rel or len(rel) > 240 or '\\' in rel or ':' in rel:
        raise PreflightError("Caminho de fonte inválido")
    sub = PurePosixPath(rel)
    if (sub.as_posix() != rel or sub.is_absolute()
            or any(part in ("..", ".", "") for part in sub.parts)):
        raise PreflightError("Fonte fora da área autorizada")
    candidate = root.joinpath(*sub.parts)
    if any(part.is_symlink() for part in (candidate, *candidate.parents)):
        raise PreflightError("Fonte com ligação simbólica não autorizada")
    try:
        if not candidate.resolve(strict=True).is_relative_to(root.resolve(strict=True)):
            raise PreflightError("Fonte fora da área autorizada")
        if not candidate.is_file() or candidate.stat().st_size > MAX_ASSET_BYTES:
            raise PreflightError("Fonte ausente ou demasiado grande")
    except (OSError, RuntimeError) as exc:
        raise PreflightError("Fonte ausente ou ilegível") from exc
    return candidate


def _hash(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def _verified_file(root: Path, record: dict, label: str, image: bool) -> tuple[int, int] | None:
    expected = record.get("sha256")
    if not isinstance(expected, str) or not SHA.fullmatch(expected):
        raise PreflightError(f"{label}: SHA-256 inválido")
    path = _local_file(root, record.get("path"))
    if _hash(path) != expected:
        raise PreflightError(f"{label}: ficheiro alterado após identificação")
    if not image:
        if path.suffix.lower() != ".csv":
            raise PreflightError(f"{label}: tipo de exportação inválido")
        # A hash alone would accept a zero-byte or unreadable CSV as evidence.
        # Validate only the header; clinical values remain unexamined.
        try:
            with path.open("rb") as probe:
                prefix = probe.read(4)
            if prefix.startswith((b"\xff\xfe\x00\x00", b"\x00\x00\xfe\xff")):
                raise PreflightError(f"{label}: codificação CSV não suportada")
            encoding = "utf-16" if prefix.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
            with path.open("r", encoding=encoding, newline="") as stream:
                first_line = stream.readline(65537)
                if len(first_line) > 65536:
                    raise PreflightError(f"{label}: cabeçalho CSV demasiado grande")
                delimiter = "\t" if "\t" in first_line else ","
                header = next(csv.reader([first_line], delimiter=delimiter, strict=True), None)
        except (OSError, UnicodeError, csv.Error) as exc:
            raise PreflightError(f"{label}: CSV ilegível") from exc
        if (not header or len(header) > 128
                or any(not name.strip() or len(name) > 256
                       or any(ord(char) < 32 for char in name) for name in header)):
            raise PreflightError(f"{label}: cabeçalho CSV inválido")
        return None
    if path.suffix.lower() != ".png":
        raise PreflightError(f"{label}: captura deve ser PNG")
    try:
        with Image.open(path) as picture:
            if picture.format != "PNG" or picture.width < 640 or picture.height < 480:
                raise PreflightError(f"{label}: imagem sem dimensão suficiente")
            dimensions = picture.size
            picture.verify()
        return dimensions
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise PreflightError(f"{label}: imagem inválida") from exc


def inspect_manifest(path: Path) -> dict:
    """Validate provenance/integrity without inferring clinical correctness."""
    path = Path(path)
    result = {
        "ok": False, "captureCount": 0, "sourceCount": 0,
        "duplicateCaptureHashes": 0, "possibleRepeatedCaptures": False,
        "requiresVisualReview": True, "requiresClinicalReview": True,
        "contactsVisuallyVerified": False, "clinicalDataConfirmed": False,
        "automaticCollection": False, "publishingAuthorized": False, "errors": [],
    }
    try:
        if path.stat().st_size > MAX_MANIFEST_BYTES:
            raise PreflightError("Manifesto demasiado grande")
        manifest = json.loads(path.read_text(encoding="utf-8-sig"),
                              object_pairs_hook=_unique_keys)
        if (not isinstance(manifest, dict) or set(manifest) != MANIFEST_FIELDS
                or type(manifest.get("schema_version")) is not int
                or manifest["schema_version"] != SCHEMA):
            raise PreflightError("Versão do manifesto inválida")
        if not _nonempty(manifest.get("plan_id")):
            raise PreflightError("Identificador de versão em falta")
        plan_id = manifest["plan_id"]
        mode = manifest.get("package_type")
        if mode not in ("guide", "full_presentation", "refinement_simple"):
            raise PreflightError("Tipo de pacote inválido")
        root = path.parent.resolve()
        captures = manifest.get("captures", [])
        sources = manifest.get("sources", [])
        if not isinstance(captures, list) or not isinstance(sources, list) or len(sources) > 3:
            raise PreflightError("Lista de fontes inválida")
        if mode == "full_presentation" and len(captures) != 8:
            raise PreflightError("Apresentação completa requer oito capturas")
        if mode != "full_presentation" and captures:
            raise PreflightError("Capturas não previstas para este tipo de pacote")
        source_seen = set()
        asset_seen = set()
        for index, record in enumerate(sources, 1):
            label = f"Fonte {index}"
            if not isinstance(record, dict) or set(record) != SOURCE_FIELDS:
                raise PreflightError(f"{label}: estrutura inválida")
            kind = record.get("kind")
            if kind not in SOURCE_KINDS or kind in source_seen:
                raise PreflightError(f"{label}: tipo repetido ou inválido")
            source_seen.add(kind)
            relative = record.get("path")
            if not isinstance(relative, str) or relative.casefold() in asset_seen:
                raise PreflightError(f"{label}: recurso duplicado ou inválido")
            asset_seen.add(relative.casefold())
            if record.get("provider") != "OnyxCeph" or record.get("plan_id") != plan_id:
                raise PreflightError(f"{label}: origem/versão incompatível")
            _verified_file(root, record, label, image=kind == "movement_table")
            result["sourceCount"] += 1
        if mode == "full_presentation" and "movement_table" not in source_seen:
            raise PreflightError("Tabela de movimentos obrigatória")
        seen = set()
        capture_hashes = set()
        dimensions = {}
        for index, record in enumerate(captures, 1):
            label = f"Captura {index}"
            if not isinstance(record, dict) or set(record) != CAPTURE_FIELDS:
                raise PreflightError(f"{label}: estrutura inválida")
            key = (record.get("phase"), record.get("view"))
            if key not in CAPTURE_SEQUENCE or key in seen:
                raise PreflightError(f"{label}: fase/vista repetida ou inválida")
            if key != CAPTURE_SEQUENCE[index - 1]:
                raise PreflightError(f"{label}: ordem não coincide com o modelo")
            seen.add(key)
            relative = record.get("path")
            if not isinstance(relative, str) or relative.casefold() in asset_seen:
                raise PreflightError(f"{label}: recurso duplicado ou inválido")
            asset_seen.add(relative.casefold())
            if record.get("provider") not in PROVIDERS or record.get("plan_id") != plan_id:
                raise PreflightError(f"{label}: origem/versão incompatível")
            if record.get("contacts_off") is not True:
                raise PreflightError(f"{label}: contactos oclusais não declarados desligados")
            if not _nonempty(record.get("orientation_ref")) or not _nonempty(record.get("scale_ref")):
                raise PreflightError(f"{label}: orientação/escala sem referência")
            dimensions[key] = _verified_file(root, record, label, image=True)
            fingerprint = record["sha256"]
            if fingerprint in capture_hashes:
                result["duplicateCaptureHashes"] += 1
                result["possibleRepeatedCaptures"] = True
            capture_hashes.add(fingerprint)
            result["captureCount"] += 1
        for view in VIEWS if mode == "full_presentation" else ():
            before = next(item for item in captures
                          if item["phase"] == "initial" and item["view"] == view)
            after = next(item for item in captures
                         if item["phase"] == "final" and item["view"] == view)
            if (before["orientation_ref"] != after["orientation_ref"]
                    or before["scale_ref"] != after["scale_ref"]):
                raise PreflightError(f"Vista {view}: referências não coincidem")
            bw, bh = dimensions[("initial", view)]
            aw, ah = dimensions[("final", view)]
            if abs(bw / bh - aw / ah) > 0.01:
                raise PreflightError(f"Vista {view}: proporções incompatíveis")
        result["ok"] = True
    except (OSError, UnicodeError, json.JSONDecodeError, PreflightError, TypeError, ValueError) as exc:
        result["errors"].append(str(exc) if isinstance(exc, PreflightError)
                                else "Não foi possível analisar o manifesto")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Conferir fontes locais sem publicar")
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    result = inspect_manifest(args.manifest)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    sys.exit(main())
