"""KEEP ALIGNER local executor. Only approved deterministic generator commands.
No patient uploads, publishing, arbitrary shell, or automatic AI inference.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

GENERATOR = Path.home() / "Dropbox" / "1_KEEP ALIGNER PORTUGAL" / "FLUXO DE TRABALHO KEEP ALIGNER" / "GERADOR KEEP ALIGNER"
ROOT = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "KeepAligner" / "LocalAgent"
INBOX, CASES, RESULTS = (ROOT / name for name in ("inbox", "cases", "results"))
VALID_MODES = {"guide", "presentation"}
VALID_STATUSES = {"unknown", "review", "approved"}
VALID_KINDS = {"unknown", "new", "modified", "refinement"}
CODE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp." + uuid.uuid4().hex)
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def read_json(path: Path, max_bytes=300_000) -> dict:
    if path.stat().st_size > max_bytes:
        raise ValueError("Ficheiro demasiado grande")
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError("Estrutura JSON inválida")
    return value


def validated_request(value: dict) -> dict:
    # Never accept command, arguments, executable or output path from the UI.
    mode = str(value.get("mode", ""))
    reference = str(value.get("reference", "")).strip()
    if mode not in VALID_MODES:
        raise ValueError("Modo inválido")
    if not reference or len(reference) > 2000 or any(ord(c) < 32 for c in reference):
        raise ValueError("Referência inválida")
    planning = str(value.get("planning", "")).strip()
    version = str(value.get("version", "")).strip()
    notes = str(value.get("notes", "")).strip()
    status = str(value.get("status", "unknown"))
    kind = str(value.get("kind", "unknown"))
    if len(planning) > 6000 or (planning and not planning.startswith("https://")):
        raise ValueError("Link do plano deve ser HTTPS")
    if len(version) > 160 or len(notes) > 2000:
        raise ValueError("Informação adicional demasiado longa")
    if status not in VALID_STATUSES or kind not in VALID_KINDS:
        raise ValueError("Estado ou tipo inválidos")
    return dict(mode=mode, reference=reference, planning=planning,
                version=version, status=status, kind=kind, notes=notes)


def enqueue(request: dict) -> dict:
    payload = validated_request(request)
    ticket = uuid.uuid4().hex
    job = dict(id=ticket, createdAt=datetime.now(timezone.utc).isoformat(),
               state="queued", request=payload)
    save_json(INBOX / (ticket + ".json"), job)
    return {"id": ticket, "state": "queued"}


def python_and_generator() -> tuple[Path, Path]:
    cfg = read_json(GENERATOR / "config.json")
    interpreter = Path(str(cfg["python"]))
    script = GENERATOR / "keep_aligner.py"
    if not interpreter.is_file() or not script.is_file():
        raise FileNotFoundError("Python ou gerador KEEP ALIGNER indisponível")
    return interpreter, script


def case_file(reference: str) -> Path | None:
    # The reference may be an external link; it is never interpreted as a
    # filesystem path, shell command, or request to navigate the browser.
    if not CODE_PATTERN.fullmatch(reference):
        return None
    file = CASES / (reference + ".json")
    return file if file.is_file() and not file.is_symlink() else None


def process_job(path: Path) -> dict:
    job = read_json(path)
    ticket = str(job.get("id", ""))
    if not re.fullmatch(r"[a-f0-9]{32}", ticket) or path.name != ticket + ".json":
        raise ValueError("Identificador de pedido inválido")
    request = validated_request(job.get("request", {}))
    result = dict(id=ticket, request=request, createdAt=job.get("createdAt", ""),
                  finishedAt=datetime.now(timezone.utc).isoformat(),
                  state="awaiting_case_data", message="Falta ficha estruturada e confirmada do caso; não foi criada guia clínica.")
    data = case_file(request["reference"])
    if data is not None:
        try:
            interpreter, script = python_and_generator()
            # Files created only in the generator's private jobs directory.
            # No archive-new, no publishing, no browser automation.
            command = [str(interpreter), str(script), "run", "--case",
                       str(data.resolve()), "--mode", request["mode"], "--no-render"]
            reply = subprocess.run(command, cwd=str(GENERATOR), timeout=300,
                                   capture_output=True, text=True, encoding="utf-8",
                                   errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            result["exitCode"] = reply.returncode
            result["stdoutTail"] = reply.stdout[-3500:]
            result["stderrTail"] = reply.stderr[-2500:]
            if reply.returncode == 0:
                result["state"] = "awaiting_visual_review"
                result["message"] = "Guia/PPTX técnico preparado; exige revisão visual e clínica antes de arquivar."
            else:
                result["state"] = "blocked"
                result["message"] = "O gerador bloqueou o caso; verificar validações sem publicar."
        except Exception as error:
            result["state"] = "blocked"
            result["message"] = type(error).__name__ + ": " + str(error)[:300]
    result["finishedAt"] = datetime.now(timezone.utc).isoformat()
    save_json(RESULTS / (ticket + ".json"), result)
    path.unlink()
    return result


def process_pending() -> list[dict]:
    INBOX.mkdir(parents=True, exist_ok=True)
    outputs = []
    for path in sorted(INBOX.glob("*.json")):
        try:
            outputs.append(process_job(path))
        except Exception as error:
            # Invalid requests are quarantined as blocked, not retried forever.
            ticket = path.stem
            save_json(RESULTS / (ticket + ".json"),
                      {"id": ticket, "state": "blocked", "message": str(error)[:300]})
            path.unlink(missing_ok=True)
    return outputs


def count_json_files(directory: Path) -> int | None:
    """Read directory metadata only: never open case or result contents."""
    try:
        return sum(1 for entry in directory.iterdir()
                   if entry.is_file() and entry.suffix == ".json")
    except FileNotFoundError:
        return 0
    except OSError:
        return None


def worker_health() -> dict:
    """A fresh heartbeat is evidence of activity, not proof a case succeeded."""
    try:
        heartbeat = read_json(ROOT / "heartbeat.json", max_bytes=16_384)
        stamp = str(heartbeat["timestamp"])
        last = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - last.astimezone(timezone.utc)).total_seconds()
        online = heartbeat.get("state") == "running" and 0 <= age <= 60
        return {"workerOnline": online, "workerLastSeenAt": stamp,
                "workerHeartbeatAgeSeconds": round(age) if 0 <= age < 1e7 else None}
    except (OSError, ValueError, TypeError, KeyError, OverflowError):
        return {"workerOnline": False, "workerLastSeenAt": None,
                "workerHeartbeatAgeSeconds": None}


def health() -> dict:
    try:
        interpreter, script = python_and_generator()
        python_ok = subprocess.run([str(interpreter), "-c", "import lxml, PIL"],
                                   timeout=15, capture_output=True).returncode == 0
    except (OSError, ValueError, subprocess.TimeoutExpired):
        interpreter = script = None
        python_ok = False
    codex = Path(os.environ.get("APPDATA", "")) / "npm" / "codex.cmd"
    worker = worker_health()
    return {"codexInstalled": codex.is_file(), "generatorInstalled": bool(script),
            "pythonReady": python_ok, "inbox": str(INBOX),
            "queueDepth": count_json_files(INBOX),
            "resultCount": count_json_files(RESULTS),
            **worker, "status": "ready" if python_ok and worker["workerOnline"] else "needs_attention",
            "publishingEnabled": False, "automaticCodexCalls": False}


def serve_forever(interval: int) -> None:
    # A per-user singleton prevents two logon tasks from racing over the inbox.
    import msvcrt
    ROOT.mkdir(parents=True, exist_ok=True)
    lock = (ROOT / "worker.lock").open("a+b")
    lock.seek(0)
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        return
    try:
        while True:
            try:
                process_pending()
                save_json(ROOT / "heartbeat.json", {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "state": "running",
                    "pid": os.getpid()
                })
            except Exception as error:
                save_json(ROOT / "last-error.json", {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "message": str(error)[:500]
                })
            time.sleep(interval)
    finally:
        lock.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Executor local KEEP ALIGNER, sem publicação")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("health")
    queue = commands.add_parser("enqueue")
    queue.add_argument("--request", type=Path, required=True)
    commands.add_parser("once")
    daemon = commands.add_parser("serve")
    daemon.add_argument("--interval", type=int, default=8)
    args = parser.parse_args()
    try:
        if args.command == "health":
            print(json.dumps(health(), ensure_ascii=False))
        elif args.command == "enqueue":
            print(json.dumps(enqueue(read_json(args.request)), ensure_ascii=False))
        elif args.command == "once":
            print(json.dumps(process_pending(), ensure_ascii=False))
        elif args.command == "serve":
            interval = max(3, min(args.interval, 60))
            serve_forever(interval)
        return 0
    except Exception as error:
        print(type(error).__name__ + ": " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
