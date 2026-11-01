"""Opt-in MSI acceptance: actual generator + native PowerPoint, synthetic inputs/templates only.
No clinical template/config is loaded. No network, archive, publication or installed agent changes.
Run using the generator's Python interpreter (Pillow, lxml, python-pptx).
"""
from __future__ import annotations
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch
from PIL import Image, ImageDraw
from pptx import Presentation
from pptx.util import Pt
from lxml import etree

REPO = Path(__file__).resolve().parents[1]
SOURCE = Path.home() / "Dropbox" / "1_KEEP ALIGNER PORTUGAL" / "FLUXO DE TRABALHO KEEP ALIGNER" / "GERADOR KEEP ALIGNER"


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def text_shape(slide, ident, content="", x=20, y=680, w=600, h=15, paragraphs=1):
    node = slide.shapes.add_textbox(Pt(x), Pt(y), Pt(w), Pt(h))
    node._element.find('.//{http://schemas.openxmlformats.org/presentationml/2006/main}cNvPr').set('id', str(ident))
    tf = node.text_frame
    tf.word_wrap = True
    for i in range(paragraphs):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        for j in range(4):
            r = p.add_run()
            r.text = content if i == 0 and j == 0 else ""
            r.font.size = Pt(12)
    return node


def templates(code, assets):
    guide = Presentation()
    guide.slide_width, guide.slide_height = Pt(652), Pt(850.5)
    one = guide.slides.add_slide(guide.slide_layouts[6])
    fixed = [38,3074,3154,3155,47,51,3144,57,62,3137,3139,3141,3145,3147,3149,3152,3156,3158,3160,3162,3164,3166,3168,3170,3172,3174]
    removed = [15,24,3142,23,37,43,46,48,49,50,52,53,54,56,10,18,3151,5,9,19,3,2,8,7,12]
    for ident in sorted(set(fixed + removed) - {3074}):
        text_shape(one, ident, w=1, h=1)
    group = one.shapes.add_group_shape()
    group._element.find('.//{http://schemas.openxmlformats.org/presentationml/2006/main}cNvPr').set('id','3074')
    title = group.shapes.add_textbox(Pt(20), Pt(15), Pt(610), Pt(40))
    title.text = 'ENSAIO TECNICO — NAO UTILIZAR EM PACIENTES'
    title.text_frame.paragraphs[0].runs[0].font.size = Pt(15)
    title._element.find('.//{http://schemas.openxmlformats.org/presentationml/2006/main}cNvPr').set('id','9000')
    for i, ident in enumerate((3245,6,3247,3249,3250)):
        text_shape(one, ident, 'CAMPO DE TESTE', y=70+i*30, h=26)
    text_shape(one, 3136, 'NOTAS DO ENSAIO', y=240, h=80, paragraphs=3)
    text_shape(one, 4, 'IMPORTANTE', y=330, h=110, paragraphs=4)
    two = guide.slides.add_slide(guide.slide_layouts[6])
    report = text_shape(two, 2, 'Relatorio Clinico — ENSAIO FICTICIO', x=25, y=20, w=602, h=810, paragraphs=30)
    for idx, value in ((9,'Objetivos e Mecânica do Tratamento'), (16,'Considerações Clínicas Importantes')):
        report.text_frame.paragraphs[idx].runs[0].text = value
    gp = code / 'synthetic-guide.pptx'
    guide.save(gp)
    comparison = Presentation()
    comparison.slide_width, comparison.slide_height = Pt(1280), Pt(720)
    slide = comparison.slides.add_slide(comparison.slide_layouts[6])
    text_shape(slide, 20, 'ENSAIO FICTICIO — SEM DADOS CLINICOS', y=20, h=35)
    text_shape(slide, 21, 'ANTES — FONTE SIMULADA', y=80, h=35)
    text_shape(slide, 22, 'RESULTADO SIMULADO', y=390, h=35)
    for i in range(8):
        placeholder = assets / f'placeholder-{i}.png'
        Image.new('RGB',(960,540),(170+i*7,180,190)).save(placeholder)
        picture = slide.shapes.add_picture(str(placeholder), Pt(20+(i%4)*315), Pt(130+(i//4)*310), Pt(300), Pt(168.75))
        picture._element.find('.//{http://schemas.openxmlformats.org/presentationml/2006/main}cNvPr').set('id',str(70+i))
    cp = code / 'synthetic-comparison.pptx'
    comparison.save(cp)
    dump(code/'config.json', {'python':sys.executable,'guide_template':str(gp),
        'guide_template_sha256':sha(gp),'comparison_template':str(cp),'comparison_template_sha256':sha(cp)})


def fixture(agent, mode):
    reference = 'keep-mock-SYNTHETIC-' + mode.upper()
    plan = 'SYNTHETIC-V1'
    stage = agent.CASES / reference
    assets = stage / 'assets'
    assets.mkdir(parents=True)
    providers = {name:{'schema_version':1,'synthetic_only':True,'case_token':'SYNTHETIC-'+mode.upper(),
        'plan_id':plan,'provider':name,'captures':[],'sources':[]} for name in ('MyKeep','HirschDynamics','OnyxCeph')}
    case = {'case_id':reference,'plan_id':plan,'patient':'AMOSTRA FICTICIA','doctor':'MEDICO FICTICIO',
        'clinic':'CLINICA FICTICIA','kind':'new','language':'pt-PT','clinical_status':'pending',
        'source_evidence':'SYNTHETIC ONLY — NO PATIENT','synthetic_only':True,'date':'11/2026',
        'aligners':{'upper':2,'lower':2},'inventory_confirmed':True,'auxiliaries_confirmed':True,
        'ipr_confirmed':True,'attachments':[],'anchors':[],'elastics':[],'absent_teeth':[],'ipr':[],
        'objectives':[{'title':'Ensaio tecnico','text':'Dados ficticios para testar documentos; sem prescricao clinica.'}],
        'commercial':{'confirmed':True,'amount_eur':0},'sources':{},'captures':[]}
    lower = list(range(48,40,-1))+list(range(31,39))
    header = [str(t)+s for t in lower for s in ('m','d')]
    (assets/'ipr.csv').write_text('Mandible\n[mm]\t'+'\t'.join(header)+'\nBefore Step 1\t'+'\t'.join(['0']*32),encoding='utf-16')
    (assets/'attachments.csv').write_text('Mandible\nColor\tReference\tName\tStep\n',encoding='utf-16')
    for kind, name in (('ipr_csv','ipr.csv'),('attachments_csv','attachments.csv')):
        providers['OnyxCeph']['sources'].append({'kind':kind,'path':'assets/'+name})
        case['sources'][kind]={'path':reference+'/assets/'+name,'plan_id':plan}
    if mode == 'presentation':
        for index, (phase, view) in enumerate((p,v) for p in ('initial','final') for v in ('front','lateral','upper','lower')):
            name = phase+'-'+view+'.png'
            image = Image.new('RGB',(960,540),(225-index*8,225-index*8,225-index*8))
            draw = ImageDraw.Draw(image)
            draw.rectangle((50,50,910,490), outline='black', width=4)
            draw.text((80,100),'SYNTHETIC ONLY / '+phase+' / '+view,fill='black')
            draw.text((80,150),'No patient anatomy. No clinical use.',fill='black')
            image.save(assets/name)
            capture={'path':'assets/'+name,'phase':phase,'view':view,'contacts_off':True,
                     'orientation_ref':'synthetic-'+view,'scale_ref':'synthetic-'+view}
            providers['HirschDynamics']['captures'].append(capture)
            case['captures'].append({**capture,'path':reference+'/assets/'+name,'plan_id':plan})
        image=Image.new('RGB',(960,540),'white')
        draw=ImageDraw.Draw(image)
        draw.rectangle((60,60,900,480),outline='black',width=3)
        draw.text((90,100),'SYNTHETIC MOVEMENT TABLE - NO CLINICAL DATA',fill='black')
        image.save(assets/'movements.png')
        providers['OnyxCeph']['sources'].append({'kind':'movement_table','path':'assets/movements.png'})
        case['sources']['movement_table']={'path':reference+'/assets/movements.png','plan_id':plan}
    for name, value in providers.items(): dump(stage/'exports'/(name+'.json'),value)
    from mock_provider_adapter import build_mock_manifest
    manifest=build_mock_manifest(stage,tuple(providers),'full_presentation' if mode=='presentation' else 'guide')
    dump(stage/'manifest.json',manifest)
    dump(agent.CASES/(reference+'.json'),case)
    return {'reference':reference,'version':plan,'mode':mode,'kind':'new','status':'review','notes':'SYNTHETIC TEST ONLY'}


def main():
    runtime = REPO / '.runtime'
    runtime.mkdir(exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix='keep-mock-acceptance-',dir=runtime))
    code = root/'generator-code'
    code.mkdir()
    (code/'assets').mkdir()
    source_hashes={}
    for name in ('keep_aligner.py','ka_core.py','ka_pptx.py','native-render.ps1'):
        content=(SOURCE/name).read_bytes()
        (code/name).write_bytes(content)
        source_hashes[name]=hashlib.sha256(content).hexdigest()
    spacer=SOURCE/'assets'/'espaco-apos-objetivos-2026-10-26.xml'
    content=spacer.read_bytes()
    parsed=etree.fromstring(content)
    if parsed.xpath('//*[local-name()="t" or local-name()="r"]'):
        raise ValueError('Style asset is not an empty non-clinical paragraph')
    (code/'assets'/spacer.name).write_bytes(content)
    placeholders=root/'synthetic-placeholders'
    placeholders.mkdir()
    templates(code,placeholders)
    os.environ['LOCALAPPDATA']=str(root/'runtime')
    sys.path.insert(0,str(REPO/'executor'))
    import agent
    agent.ROOT=root/'isolated-agent'
    agent.INBOX, agent.CASES, agent.RESULTS=(agent.ROOT/name for name in ('inbox','cases','results'))
    agent.GENERATOR=code
    agent.GENERATOR_JOBS=root/'runtime'/'KEEP ALIGNER GENERATOR'/'jobs'
    if not agent.INBOX.is_relative_to(root): raise RuntimeError('Queue isolation failed')
    events=[]
    original_save=agent.save_json
    def record(path,value):
        original_save(path,value)
        if path.parent == agent.RESULTS: events.append({'id':value.get('id'),'state':value.get('state')})
    report={'syntheticOnly':True,'originalGeneratorModified':False,'clinicalFilesAccessed':False,
            'sourceCodeSha256':source_hashes,'templates':'created from scratch; NOT clinical templates',
            'clinicalApproval':False,'publishingAuthorized':False,'runs':[],'root':str(root)}
    try:
        with patch.object(agent,'save_json',side_effect=record):
            requests=[fixture(agent,'guide'),fixture(agent,'presentation')]
            for request in requests+[requests[1]]:
                ticket=agent.enqueue(request)
                result=agent.process_job(agent.INBOX/(ticket['id']+'.json'))
                report['runs'].append(result)
                if result['state']!='awaiting_visual_review' or not result.get('artifactReport',{}).get('verified'):
                    raise RuntimeError(result.get('message','Acceptance failed'))
        events_last=json.loads(report['runs'][-1]['stdoutTail'])['stages']
        if not events_last or any(e['status']!='reused' for e in events_last):
            raise RuntimeError('Resume did not reuse every verified completed stage')
        report['resumeVerified']=True
        report['ok']=True
    except Exception as error:
        report['ok']=False
        report['error']=type(error).__name__+': '+str(error)
    report['states']=events
    dump(root/'acceptance-report.json',report)
    print(json.dumps({'ok':report['ok'],'report':str(root/'acceptance-report.json'),
        'runs':len(report['runs']),'error':report.get('error'),'clinicalApproval':False,'publishingAuthorized':False},ensure_ascii=False))
    return 0 if report['ok'] else 2


if __name__=='__main__':
    sys.exit(main())
