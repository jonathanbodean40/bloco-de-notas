"""Read back deterministic generator outputs. Never grant clinical/publication approval."""
from __future__ import annotations
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile, BadZipFile
from PIL import Image
from source_preflight import PreflightError, _local_file, _hash, _unique_keys


def read_object(path: Path) -> dict:
    if path.is_symlink() or path.stat().st_size > 512 * 1024:
        raise PreflightError("Recibo inválido ou demasiado grande")
    value = json.loads(path.read_text(encoding="utf-8-sig"), object_pairs_hook=_unique_keys)
    if not isinstance(value, dict):
        raise PreflightError("Recibo estruturado inválido")
    return value


def verify_outputs(stdout: str, jobs_root: Path, case_path: Path, request: dict) -> dict:
    """A zero process exit alone is not evidence that any usable files were produced."""
    if len(stdout) > 512 * 1024:
        raise PreflightError("Resposta do gerador demasiado grande")
    reply = json.loads(stdout, object_pairs_hook=_unique_keys)
    if not isinstance(reply, dict) or not isinstance(reply.get("job"), str):
        raise PreflightError("Gerador não identificou o trabalho produzido")
    jobs_root = Path(jobs_root).absolute()
    job = Path(reply["job"])
    if not job.is_absolute() or job.parent != jobs_root or job.is_symlink():
        raise PreflightError("Resultado fora da área de trabalhos autorizada")
    if any(p.is_symlink() for p in (jobs_root, *job.parents)):
        raise PreflightError("Área de resultados redirecionada")
    job = job.resolve(strict=True)
    if job.parent != jobs_root.resolve(strict=True):
        raise PreflightError("Área de resultados inválida")
    receipt = read_object(_local_file(job, "receipt.json"))
    case = read_object(case_path)
    if (case.get("case_id") != request["reference"] or case.get("plan_id") != request["version"]
            or receipt.get("case_id") != case["case_id"] or receipt.get("plan_id") != case["plan_id"]
            or receipt.get("mode") != request["mode"]
            or receipt.get("case_file_sha256") != _hash(case_path)
            or Path(receipt.get("case_file", "")).resolve() != case_path.resolve()):
        raise PreflightError("Resultado não corresponde ao pedido e à ficha atuais")
    if (receipt.get("status") != "awaiting_visual_review"
            or receipt.get("publication_authorized") is not False
            or receipt.get("visual_review_complete") is not False
            or receipt.get("native_rendered") is not True):
        raise PreflightError("Resultado sem renderização nativa ou com estado de revisão indevido")
    outputs = receipt.get("outputs")
    required = {"GUIA.pptx", "guide-1.png", "guide-2.png", "guide-native.json"}
    if request["mode"] == "presentation":
        required |= {"ANTES E DEPOIS.pptx", "comparison-1.png", "comparison-native.json",
                     "movement-table.png", "RELATORIO CLINICO.txt"}
    if not isinstance(outputs, dict) or set(outputs) != required:
        raise PreflightError("O pacote não contém todos os documentos e prévias exigidos")
    records = []
    for name, expected in sorted(outputs.items()):
        if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise PreflightError("Integridade de resultado inválida")
        path = _local_file(job, name)
        if not path.stat().st_size or _hash(path) != expected:
            raise PreflightError("Documento vazio ou alterado depois da geração")
        if name.endswith(".pptx"):
            try:
                with ZipFile(path) as archive:
                    entries = archive.infolist()
                    names = [item.filename for item in entries]
                    if len(names) != len(set(names)) or not {'[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml'}.issubset(names):
                        raise PreflightError("Estrutura PowerPoint incompleta ou ambígua")
                    if (len(entries) > 2000 or sum(item.file_size for item in entries) > 128 * 1024 * 1024
                            or archive.testzip() is not None):
                        raise PreflightError("PowerPoint inválido")
                    count = sum(bool(re.fullmatch(r"ppt/slides/slide\d+\.xml", item.filename)) for item in entries)
                    if count != (2 if name == "GUIA.pptx" else 1):
                        raise PreflightError("Número de páginas inesperado")
            except BadZipFile as exc:
                raise PreflightError("PowerPoint ilegível") from exc
        elif name.endswith(".png"):
            with Image.open(path) as image:
                if image.format != "PNG" or image.width < 1 or image.height < 1:
                    raise PreflightError("Prévia PNG inválida")
                if name == "comparison-1.png" and image.size != (3840, 2160):
                    raise PreflightError("Antes/depois sem resolução 4K")
                image.verify()
        records.append({"name": name, "sha256": expected, "bytes": path.stat().st_size})
    for prefix, count in (("guide", 2), ("comparison", 1)):
        if prefix == "comparison" and request["mode"] != "presentation":
            continue
        native = read_object(_local_file(job, prefix + "-native.json"))
        expected_exports = [job / (prefix + "-" + str(i) + ".png") for i in range(1, count + 1)]
        if (native.get("nativePowerPoint") is not True or native.get("overflows") != []
                or native.get("slides") != count
                or native.get("exports") != [str(p) for p in expected_exports]):
            raise PreflightError("Renderização nativa incompleta ou com texto excedido")
    for filename in ("guide-validation.json",) + (("comparison-validation.json",) if request["mode"] == "presentation" else ()):
        validation = read_object(_local_file(job, filename))
        if validation.get("ok") is not True or validation.get("errors") != []:
            raise PreflightError("Conferência independente dos documentos não aprovada")
    preview = _local_file(job, "PREVIA.html")
    if not preview.stat().st_size:
        raise PreflightError("Prévia de revisão ausente")
    return {"verified": True, "jobDirectory": str(job), "files": records,
            "previewSha256": _hash(preview), "nativeRendered": True,
            "clinicalApproval": False, "publishingAuthorized": False,
            "requiresVisualReview": True, "requiresClinicalReview": True}
