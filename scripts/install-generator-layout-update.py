"""Install only the accepted report-layout code, retaining a verified rollback.
No template, patient file, queue request, notes profile, or remote platform is modified.
"""
import argparse
import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
import importlib.util
_spec=importlib.util.spec_from_file_location('layout_preparation',Path(__file__).with_name('prepare-generator-layout-update.py'))
_preparation=importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_preparation)
BASE_SHA,GENERATOR,REPO,patched_source,sha=(_preparation.BASE_SHA,_preparation.GENERATOR,_preparation.REPO,_preparation.patched_source,_preparation.sha)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--preparation',required=True,type=Path)
    args=parser.parse_args()
    preparation=json.loads(args.preparation.read_text(encoding='utf-8'))
    root=Path(preparation['root']);candidate=root/'generator'
    expected_parent=Path.home()/'Documents'/'KeepAligner_LocalTests'
    if root.parent!=expected_parent or not root.name.startswith('report-layout-'):
        raise ValueError('Only an isolated local acceptance is eligible')
    evidence=json.loads((root/'native-layout-acceptance.json').read_text(encoding='utf-8'))
    needed=('passed','generatorRegressionPassed','sourcesUnchanged','templatesUnchanged',
            'originalGuideUnchanged','resumeVerified','excessiveReportBlocked','nativePowerPoint','clinicalTextUnchanged')
    if (any(evidence.get(k) is not True for k in needed)
            or evidence.get('nativeOverflowCount')!=0
            or evidence.get('clinicalApproval') is not False
            or evidence.get('publishingAuthorized') is not False):
        raise ValueError('Native acceptance evidence is incomplete')
    if sha(GENERATOR/'keep_aligner.py')!=BASE_SHA:
        raise ValueError('Installed generator has changed; do not overwrite')
    for name,h in preparation['originalHashes'].items():
        if sha(GENERATOR/name)!=h:raise ValueError('An original component has changed')
    for name in ('keep_aligner.py','ka_report_layout.py'):
        h=sha(candidate/name)
        if preparation['candidateHashes'].get(name)!=h or evidence['candidateHashes'].get(name)!=h:
            raise ValueError('Candidate is not the tested version')
        compile((candidate/name).read_text(encoding='utf-8'),name,'exec')
    expected=patched_source((GENERATOR/'keep_aligner.py').read_text(encoding='utf-8'))
    if (candidate/'keep_aligner.py').read_text(encoding='utf-8')!=expected:
        raise ValueError('Candidate contains changes outside the reviewed patch')
    if sha(candidate/'ka_report_layout.py')!=sha(REPO/'generator_support'/'ka_report_layout.py'):
        raise ValueError('Layout helper differs from source')
    agent=Path(os.environ['LOCALAPPDATA'])/'KeepAligner'/'LocalAgent'
    if list((agent/'inbox').glob('*.json')):raise ValueError('Queue is not empty')
    check=subprocess.run(['powershell.exe','-NoProfile','-Command',
        "$p=Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^pythonw?\\.exe$' -and $_.CommandLine -like '*keep_aligner.py*'}; if($p){exit 9}"],
        capture_output=True,timeout=20)
    if check.returncode:raise ValueError('A generator may be running; installation stopped')
    backup_parent=agent.parent/'GeneratorBackups';backup_parent.mkdir(parents=True,exist_ok=True)
    backup=Path(tempfile.mkdtemp(prefix=datetime.now().strftime('%Y%m%d-%H%M%S-'),dir=backup_parent))
    names=('ka_report_layout.py','keep_aligner.py')
    previous={}
    for name in names:
        target=GENERATOR/name
        if target.exists():
            previous[name]=sha(target);shutil.copy2(target,backup/name)
            if sha(backup/name)!=previous[name]:raise ValueError('Backup verification failed')
        else:previous[name]=None
    deployed=[]
    try:
        for name in names:
            target=GENERATOR/name
            stage=GENERATOR/(name+'.stage-'+backup.name)
            with stage.open('xb') as out:out.write((candidate/name).read_bytes())
            if sha(stage)!=preparation['candidateHashes'][name]:raise ValueError('Staging mismatch')
            os.replace(stage,target)
            deployed.append(name)
        for name in names:
            if sha(GENERATOR/name)!=preparation['candidateHashes'][name]:raise ValueError('Installed mismatch')
    except Exception:
        for name in reversed(deployed):
            target=GENERATOR/name
            if previous[name] is None:
                shutil.move(str(target),str(backup/(name+'.not-active')))
            else:
                temp=GENERATOR/(name+'.rollback-'+backup.name)
                shutil.copy2(backup/name,temp);os.replace(temp,target)
        raise
    receipt={'schema':1,'installedAt':datetime.now(timezone.utc).isoformat(),'installed':True,
             'backup':str(backup),'previousHashes':previous,'installedHashes':preparation['candidateHashes'],
             'templatesChanged':False,'patientFilesChanged':False,'notesChanged':False,
             'syntheticOnlyGateChanged':False,'clinicalApproval':False,'publishingAuthorized':False}
    for directory in (backup,root):
        (directory/'installation-receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print(json.dumps(receipt))


if __name__=='__main__':main()
