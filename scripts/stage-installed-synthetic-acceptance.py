"""Explicitly stage a brand-new, entirely fictitious presentation for installed acceptance.
Does not enqueue anything, read patient cases, or change any existing staged file.
"""
import argparse
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import uuid
from pathlib import Path
from types import SimpleNamespace


def main():
    p=argparse.ArgumentParser();p.add_argument('--confirm-synthetic',action='store_true',required=True)
    p.parse_args()
    repo=Path(__file__).resolve().parents[1]
    sys.path.insert(0,str(repo/'executor'))
    spec=importlib.util.spec_from_file_location('synthetic_acceptance',Path(__file__).with_name('keep-workflow-acceptance.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    parent=Path.home()/'Documents'/'KeepAligner_LocalTests';parent.mkdir(exist_ok=True)
    root=Path(tempfile.mkdtemp(prefix='keep-mock-installed-',dir=parent))
    proxy=SimpleNamespace(CASES=root/'cases')
    request=module.fixture(proxy,'presentation',uuid.uuid4().hex[:12])
    reference=request['reference']
    case_file=proxy.CASES/(reference+'.json')
    case=json.loads(case_file.read_text(encoding='utf-8'))
    if (case.get('synthetic_only') is not True or case.get('patient')!='AMOSTRA FICTICIA'
            or case.get('doctor')!='MEDICO FICTICIO' or case.get('clinic')!='CLINICA FICTICIA'):
        raise ValueError('Factory did not produce the expected entirely fictitious case')
    agent=Path(os.environ['LOCALAPPDATA'])/'KeepAligner'/'LocalAgent'
    if list((agent/'inbox').glob('*.json')):raise ValueError('Live queue is not empty')
    destination=agent/'cases'
    for folder in (agent,destination):
        if folder.exists() and (folder.is_symlink() or getattr(folder.lstat(),'st_file_attributes',0)&0x400):
            raise ValueError('Redirected staging root')
    destination.mkdir(exist_ok=True)
    staged=destination/reference;target=destination/(reference+'.json')
    if staged.exists() or target.exists():raise ValueError('Refuse to overwrite an existing case')
    shutil.copytree(proxy.CASES/reference,staged)
    with target.open('x',encoding='utf-8') as f:f.write(case_file.read_text(encoding='utf-8'))
    report={'syntheticOnly':True,'request':request,'root':str(root),
            'clinicalApproval':False,'publishingAuthorized':False,'enqueued':False}
    output=root/'staged-synthetic-request.json'
    output.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'stagingReceipt':str(output),'reference':reference,'syntheticOnly':True,'enqueued':False}))


if __name__=='__main__':main()
