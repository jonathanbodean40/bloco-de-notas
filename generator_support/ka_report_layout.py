"""Adjust explicit 14pt report body to 12pt in a new generated copy only.
Preserve headings, blanks, text, geometry and all other package members.
Native PowerPoint must still validate the result; no clinical approval.
"""
from __future__ import annotations
import copy
import hashlib
import math
import uuid
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

NS = {'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
REPORT_PART = 'ppt/slides/slide2.xml'
HEADINGS = {'relatório clínico', 'relatorio clinico',
            'objetivos e mecânica do tratamento', 'considerações clínicas importantes'}
MAX_BYTES = 64 * 1024 * 1024


class LayoutError(ValueError):
    pass


def report_only_overflow(metadata: dict) -> bool:
    """Classify measurements without approving rendering or removing alerts."""
    if not isinstance(metadata, dict) or metadata.get('nativePowerPoint') is not True:
        return False
    if type(metadata.get('slides')) is not int or metadata['slides'] != 2:
        return False
    alerts = metadata.get('overflows')
    if not isinstance(alerts, list) or not alerts:
        return False
    for item in alerts:
        if (not isinstance(item, dict) or type(item.get('slide')) is not int
                or type(item.get('id')) is not int or item['slide'] != 2 or item['id'] != 2):
            return False
        values = [item.get(k) for k in ('width', 'height', 'boundWidth', 'boundHeight')]
        if any(type(x) not in (int, float) or not math.isfinite(x) or x <= 0 for x in values):
            return False
        w, h, bw, bh = values
        if bw <= w + 1 and bh <= h + 1:
            return False
    return True


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _regular(path: Path) -> Path:
    path = Path(path).absolute()
    for item in (path, *path.parents):
        info = item.lstat()
        if item.is_symlink() or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise LayoutError('Documento redirecionado não permitido')
    if not path.is_file() or path.stat().st_size > MAX_BYTES:
        raise LayoutError('Documento inválido ou demasiado grande')
    return path


def fit_report_body(source: Path, target: Path) -> dict:
    """Create a distinct generated draft beside source; never modify source."""
    source = _regular(source)
    target = Path(target).absolute()
    if (source.suffix.lower() != '.pptx' or target.suffix.lower() != '.pptx'
            or target.parent != source.parent or source == target):
        raise LayoutError('O ajuste exige uma cópia PPTX na mesma pasta de trabalho')
    if target.exists():
        raise LayoutError('A cópia de ajuste já existe; não substituir automaticamente')
    parser = E.XMLParser(resolve_entities=False, no_network=True)
    with ZipFile(source) as archive:
        names = archive.namelist()
        if (len(names) != len(set(names)) or len(names) > 2000
                or sum(i.file_size for i in archive.infolist()) > MAX_BYTES * 2
                or REPORT_PART not in names or archive.testzip() is not None):
            raise LayoutError('Estrutura PPTX inválida')
        tree = E.fromstring(archive.read(REPORT_PART), parser)
        candidates = tree.xpath('./p:cSld/p:spTree/p:sp[p:nvSpPr/p:cNvPr[@id="2"]]', namespaces=NS)
        if len(candidates) != 1:
            raise LayoutError('Caixa única do relatório não identificada')
        original = E.tostring(tree, method='c14n')
        before_text = tree.xpath('//a:t/text()', namespaces=NS)
        changes = []
        body = candidates[0].find('p:txBody', NS)
        if body is None:
            raise LayoutError('Relatório sem estrutura de texto')
        for paragraph in body.findall('a:p', NS):
            value = ''.join(paragraph.xpath('.//a:t/text()', namespaces=NS)).strip()
            if not value or ' '.join(value.casefold().split()) in HEADINGS:
                continue
            for node in paragraph.xpath('.//a:rPr | .//a:defRPr | .//a:endParaRPr', namespaces=NS):
                if node.get('sz') == '1400':
                    changes.append(node)
                    node.set('sz', '1200')
        if not changes:
            raise LayoutError('Sem corpo de 14 pt elegível; exige revisão de composição')
        if tree.xpath('//a:t/text()', namespaces=NS) != before_text:
            raise LayoutError('O conteúdo do relatório foi alterado')
        modified = E.tostring(tree, xml_declaration=True, encoding='UTF-8', standalone=True)
        for node in changes:
            node.set('sz', '1400')
        if E.tostring(tree, method='c14n') != original:
            raise LayoutError('Alteração além da tipografia permitida')
        original_hash = sha(source)
        temporary = target.with_name(target.name + '.tmp-' + uuid.uuid4().hex)
        try:
            with ZipFile(temporary, 'x', ZIP_DEFLATED) as out:
                for item in archive.infolist():
                    out.writestr(copy.copy(item), modified if item.filename == REPORT_PART else archive.read(item.filename))
            with ZipFile(temporary) as check:
                if check.testzip() is not None:
                    raise LayoutError('Cópia ajustada inválida')
                for name in names:
                    if name != REPORT_PART and check.read(name) != archive.read(name):
                        raise LayoutError('Um componente não autorizado foi alterado')
            if sha(source) != original_hash:
                raise LayoutError('O documento de origem mudou durante a operação')
            with target.open('xb') as destination, temporary.open('rb') as input_file:
                for chunk in iter(lambda: input_file.read(1024 * 1024), b''):
                    destination.write(chunk)
        finally:
            temporary.unlink(missing_ok=True)
    return {'schema': 1, 'bodyFontPt': 12, 'fontPropertiesChanged': len(changes),
            'clinicalTextUnchanged': True, 'headingsPreserved': True,
            'emptyParagraphsPreserved': True, 'geometryPreserved': True,
            'sourceSha256': original_hash, 'resultSha256': sha(target),
            'requiresNativeValidation': True, 'clinicalApproval': False,
            'publishingAuthorized': False}
