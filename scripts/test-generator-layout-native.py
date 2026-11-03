"""Opt-in local layout acceptance on an explicitly selected owner-authorized case.
All generated files/copies remain in the private candidate test directory.
Does not call review/archive/publish or write to any source/platform.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def dump(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2),encoding='utf-8')


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--preparation',required=True,type=Path)
    parser.add_argument('--case',required=True,type=Path)
    args=parser.parse_args()
    config=json.loads(args.preparation.read_text(encoding='utf-8'))
    root=Path(config['root']);code=Path(config['generator'])
    if not root.name.startswith('report-layout-') or code != root/'generator':
        raise ValueError('Invalid isolated preparation')
    for name,h in config['candidateHashes'].items():
        if sha(code/name)!=h:raise ValueError('Candidate changed after preparation')
    originals={str(args.case):sha(args.case)}
    if (args.case.parent/'GUIA.pptx').is_file():
        originals[str(args.case.parent/'GUIA.pptx')]=sha(args.case.parent/'GUIA.pptx')
    fixture=json.loads(args.case.read_text(encoding='utf-8-sig'))
    sources=root/'sources';sources.mkdir(exist_ok=False)
    for key,record in fixture.get('sources',{}).items():
        path=Path(record['path'])
        if not path.is_absolute():path=args.case.parent/path
        if path.suffix.lower() not in ('.csv','.png') or not path.is_file():
            raise ValueError('Unsupported explicit local test source')
        originals[str(path)]=sha(path)
        if record.get('sha256') and record['sha256']!=sha(path):
            raise ValueError('Existing case source has changed; do not infer a new version')
        target=sources/(key+path.suffix.lower())
        shutil.copy2(path,target)
        record['path']=str(target)
    # Guide mode does not consume anatomical captures. Do not collect additional data.
    copied=root/'case-copy.json';dump(copied,fixture)
    cfg=json.loads((code/'config.json').read_text(encoding='utf-8'))
    for key in ('guide_template','comparison_template'):
        originals[cfg[key]]=sha(cfg[key])
    environment={**os.environ,'LOCALAPPDATA':str(root/'regression-runtime'),'PYTHONDONTWRITEBYTECODE':'1'}
    regression=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s',str(code),'-p','test_*.py','-v'],
        cwd=code,env=environment,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=180)
    (root/'generator-regression.txt').write_text(regression.stdout+'\n'+regression.stderr,encoding='utf-8')
    if regression.returncode:raise ValueError('Existing generator regression failed; inspect private log')
    sys.path.insert(0,str(code))
    import keep_aligner as app
    from ka_core import Blocked
    app.RUN_ROOT=root/'jobs'
    job,receipt=app.run(copied,'guide',render=True)
    first_events=receipt['events']
    layout=app.read_json(job/'guide-layout.json')
    native=app.read_json(job/'guide-native.json')
    qa=app.read_json(job/'guide-validation.json')
    if (not qa['ok'] or native['overflows'] or receipt['status']!='awaiting_visual_review'
            or receipt['visual_review_complete'] or receipt['publication_authorized']):
        raise ValueError('Native real-case layout acceptance failed')
    _,repeat=app.run(copied,'guide',render=True)
    if not repeat['events'] or any(e['status']!='reused' for e in repeat['events']):
        raise ValueError('Resume regenerated completed stages unnecessarily')
    # Synthetic excessive text must remain blocked, not silently omitted or shrunk below 12pt.
    from test_generator import sample
    excessive=sample()
    excessive.update(case_id='SYNTHETIC-OVERFLOW',patient='SYNTHETIC ONLY',doctor='SYNTHETIC DOCTOR',
        clinic='SYNTHETIC CLINIC',clinical_status='pending',attachments=[],anchors=[],elastics=[],
        ipr=[],absent_teeth=[],sources={},aligners={'upper':4,'lower':4},
        objectives=[{'title':'Synthetic test','text':'SYNTHETIC BODY. '*1000}])
    too_long=root/'synthetic-overflow.json';dump(too_long,excessive)
    blocked=False
    try:app.run(too_long,'guide',render=True)
    except Blocked:blocked=True
    if not blocked:raise ValueError('Excessive report was not blocked')
    for path,h in originals.items():
        if sha(path)!=h:raise ValueError('A source or original template changed during testing')
    result={'passed':True,'checkedAt':datetime.now(timezone.utc).isoformat(),
        'candidateHashes':config['candidateHashes'],'jobDirectory':str(job),
        'generatorRegressionPassed':True,'bodyFontPt':layout['bodyFontPt'],
        'fontPropertiesChanged':layout['fontPropertiesChanged'],'independentChecks':qa['checks_passed'],
        'nativeOverflowCount':len(native['overflows']),'nativePowerPoint':native['nativePowerPoint'],
        'clinicalTextUnchanged':layout['clinicalTextUnchanged'],'sourcesUnchanged':True,
        'templatesUnchanged':True,'originalGuideUnchanged':True,'resumeVerified':True,
        'excessiveReportBlocked':True,'firstEvents':first_events,'repeatEvents':repeat['events'],
        'clinicalApproval':False,'publishingAuthorized':False,'onlineVersionVerified':False}
    dump(root/'native-layout-acceptance.json',result)
    print(json.dumps({k:v for k,v in result.items() if k not in ('firstEvents','repeatEvents')},ensure_ascii=False))


if __name__=='__main__':main()
