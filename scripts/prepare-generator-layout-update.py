"""Prepare an isolated generator candidate; never change the installed generator.
The two template references point to the original read-only official templates.
No patient data or templates are copied into the public source repository.
"""
from __future__ import annotations
import hashlib
import json
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
GENERATOR = Path.home()/'Dropbox'/'1_KEEP ALIGNER PORTUGAL'/'FLUXO DE TRABALHO KEEP ALIGNER'/'GERADOR KEEP ALIGNER'
BASE_SHA = '8930ded33f332b7cf458d00907dbcbbd1ce5a618454bc9951c7ec22a4bc5a435'


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError('Generator source differs from the reviewed version')
    return text.replace(old, new, 1)


def patched_source(text):
    text = replace_once(text,
        'from ka_pptx import build_guide, validate_guide, build_comparison, count_sentence, mm',
        'from ka_pptx import build_guide, validate_guide, build_comparison, count_sentence, mm\nfrom ka_report_layout import fit_report_body, report_only_overflow')
    text = replace_once(text,
        'def native(job,deck,prefix,comparison=False):',
        'def native(job,deck,prefix,comparison=False,report_probe=False):')
    text = replace_once(text,
        "    if meta['overflows']:raise Blocked('PowerPoint detetou texto sem espaço: '+', '.join(str(x['id']) for x in meta['overflows']))",
        "    if meta['overflows'] and not (report_probe and not comparison and report_only_overflow(meta)):\n        raise Blocked('PowerPoint detetou texto sem espaço: '+', '.join(str(x['id']) for x in meta['overflows']))")
    text = replace_once(text,
        "        common={'code':code_hash(),'case':clinical,'guide_template':digest(cfg['guide_template'])}",
        "        common={'code':code_hash(),'case':clinical,'guide_template':digest(cfg['guide_template']),'native_report_layout':render}")
    old = "        stage('guide',common,lambda:[build_guide(c,cfg['guide_template'],guide)])"
    new = '''        def prepare_guide():
            if not render:
                return [build_guide(c,cfg['guide_template'],guide)]
            # Fit only a freshly generated draft; never edit the official template.
            draft=job.path/'guide-unfitted.pptx'
            build_guide(c,cfg['guide_template'],draft)
            measured=native(job,draft,'guide-probe',report_probe=True)
            measurement=read_json(job.path/'guide-probe-native.json')
            candidate=job.path/('guide-layout-'+str(time.time_ns())+'.pptx')
            if measurement['overflows']:
                layout=fit_report_body(draft,candidate)
            else:
                with candidate.open('xb') as target:target.write(draft.read_bytes())
                layout={'schema':1,'bodyFontPt':None,'fontPropertiesChanged':0,
                        'clinicalTextUnchanged':True,'headingsPreserved':True,
                        'emptyParagraphsPreserved':True,'geometryPreserved':True,
                        'sourceSha256':digest(draft),'resultSha256':digest(candidate),
                        'requiresNativeValidation':True,'clinicalApproval':False,
                        'publishingAuthorized':False}
            checked=validate_guide(c,cfg['guide_template'],candidate)
            if not checked['ok']:
                raise Blocked('Ajuste tipográfico falhou a conferência independente.')
            candidate.replace(guide)
            layout_path=job.path/'guide-layout.json'
            atomic_json(layout_path,layout)
            # Preserve the unfitted draft and its measurements; resume verifies all hashes.
            return [guide,draft,layout_path]+measured
        stage('guide',common,prepare_guide)'''
    return replace_once(text, old, new)


def prepare():
    source = GENERATOR/'keep_aligner.py'
    if sha(source) != BASE_SHA:
        raise ValueError('Installed generator is not the reviewed base; no candidate prepared')
    base = Path.home()/'Documents'/'KeepAligner_LocalTests'
    base.mkdir(parents=True,exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix='report-layout-',dir=base))
    code = root/'generator'
    code.mkdir()
    originals = {}
    files = ('keep_aligner.py','ka_core.py','ka_pptx.py','native-render.ps1',
             'test_generator.py','test_cutout_upgrade.py','test_refinement_simple.py')
    for name in files:
        original=GENERATOR/name
        shutil.copy2(original,code/name)
        originals[name]=sha(original)
    assets=code/'assets'
    assets.mkdir()
    for name in ('espaco-apos-objetivos-2026-10-26.xml',
                 'recorte-elastico-corrigido-2026-10-26.json',
                 'recorte-elastico-original-2026-10-26.png'):
        shutil.copy2(GENERATOR/'assets'/name,assets/name)
    config=json.loads((GENERATOR/'config.json').read_text(encoding='utf-8-sig'))
    for key in ('guide_template','comparison_template'):
        template=Path(config[key])
        if not template.is_absolute():template=GENERATOR/template
        if sha(template)!=config[key+'_sha256']:
            raise ValueError('Official template does not match the configured hash')
        config[key]=str(template.resolve())
    (code/'config.json').write_text(json.dumps(config,indent=2),encoding='utf-8')
    text=(code/'keep_aligner.py').read_text(encoding='utf-8')
    text=patched_source(text)
    compile(text,'keep_aligner.py','exec')
    (code/'keep_aligner.py').write_text(text,encoding='utf-8',newline='\n')
    shutil.copy2(REPO/'generator_support'/'ka_report_layout.py',code/'ka_report_layout.py')
    record={'schema':1,'preparedAt':datetime.now(timezone.utc).isoformat(),'root':str(root),
            'generator':str(code),'installedGenerator':str(GENERATOR),'originalHashes':originals,
            'candidateHashes':{n:sha(code/n) for n in ('keep_aligner.py','ka_report_layout.py')},
            'installed':False,'templatesModified':False,'clinicalApproval':False,'publishingAuthorized':False}
    path=root/'preparation.json'
    path.write_text(json.dumps(record,indent=2),encoding='utf-8')
    print(json.dumps({'preparation':str(path),'generator':str(code)}))


if __name__=='__main__':
    prepare()
