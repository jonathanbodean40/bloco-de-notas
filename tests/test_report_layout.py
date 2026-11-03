"""Typography-only tests, with entirely synthetic ZIP/XML fixtures."""
import copy
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'generator_support'))
from ka_report_layout import fit_report_body, report_only_overflow, LayoutError, NS, REPORT_PART


class ReportLayoutTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='keep-layout-synthetic-')
        self.root=Path(self.tmp.name)
        self.source=self.root/'source.pptx'
        self.target=self.root/'fitted.pptx'
        self.xml=('''<p:sld xmlns:p="%s" xmlns:a="%s"><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Report"/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:r><a:rPr sz="2000"/><a:t>Relatório Clínico</a:t></a:r></a:p>
<a:p><a:r><a:rPr sz="1400" b="1"/><a:t>Objetivos e Mecânica do Tratamento</a:t></a:r></a:p>
<a:p><a:endParaRPr sz="1400"/></a:p>
<a:p><a:pPr><a:defRPr sz="1400"/></a:pPr><a:r><a:rPr sz="1400"/><a:t>Estimado Doutor,</a:t></a:r><a:endParaRPr sz="1400"/></a:p>
<a:p><a:r><a:rPr sz="1400"/><a:t>Texto fictício com número 12 e acentuação; não clínico.</a:t></a:r></a:p>
<a:p><a:r><a:rPr sz="1200"/><a:t>Já tem 12 pt.</a:t></a:r></a:p>
<a:p><a:r><a:rPr sz="1400" b="1"/><a:t>Considerações Clínicas Importantes</a:t></a:r></a:p>
</p:txBody></p:sp></p:spTree></p:cSld></p:sld>'''%(NS['p'],NS['a'])).encode('utf-8')
        self.make()
        self.original=self.source.read_bytes()

    def make(self,xml=None):
        with ZipFile(self.source,'w') as archive:
            archive.writestr(REPORT_PART,self.xml if xml is None else xml)
            archive.writestr('ppt/slides/slide1.xml',b'unchanged-synthetic-odontogram')
            archive.writestr('ppt/media/image1.png',b'unchanged-synthetic-symbol')

    def tearDown(self):self.tmp.cleanup()

    def test_body_only_changes_to_twelve(self):
        report=fit_report_body(self.source,self.target)
        self.assertEqual(report['fontPropertiesChanged'],4)
        self.assertEqual(report['bodyFontPt'],12)
        with ZipFile(self.target) as archive:
            tree=E.fromstring(archive.read(REPORT_PART))
            sizes=tree.xpath('//a:rPr/@sz',namespaces=NS)
            self.assertEqual(sizes,['2000','1400','1200','1200','1200','1400'])
            self.assertEqual(tree.xpath('//a:p[3]/a:endParaRPr/@sz',namespaces=NS),['1400'])

    def test_clinical_text_and_source_are_unchanged(self):
        fit_report_body(self.source,self.target)
        self.assertEqual(self.source.read_bytes(),self.original)
        with ZipFile(self.target) as archive:
            self.assertEqual(E.fromstring(archive.read(REPORT_PART)).xpath('//a:t/text()',namespaces=NS),
                             E.fromstring(self.xml).xpath('//a:t/text()',namespaces=NS))
            self.assertEqual(archive.read('ppt/slides/slide1.xml'),b'unchanged-synthetic-odontogram')
            self.assertEqual(archive.read('ppt/media/image1.png'),b'unchanged-synthetic-symbol')

    def test_report_retains_human_review_requirements(self):
        report=fit_report_body(self.source,self.target)
        for key in ('clinicalTextUnchanged','headingsPreserved','emptyParagraphsPreserved','geometryPreserved','requiresNativeValidation'):
            self.assertIs(report[key],True)
        self.assertIs(report['clinicalApproval'],False)
        self.assertIs(report['publishingAuthorized'],False)

    def test_same_source_destination_rejected(self):
        with self.assertRaises(LayoutError):fit_report_body(self.source,self.source)
        self.assertEqual(self.source.read_bytes(),self.original)

    def test_existing_destination_is_preserved(self):
        self.target.write_bytes(b'keep')
        with self.assertRaises(LayoutError):fit_report_body(self.source,self.target)
        self.assertEqual(self.target.read_bytes(),b'keep')

    def test_other_directory_is_rejected(self):
        other=self.root/'other';other.mkdir()
        with self.assertRaises(LayoutError):fit_report_body(self.source,other/'out.pptx')

    def test_wrong_extension_is_rejected(self):
        with self.assertRaises(LayoutError):fit_report_body(self.source,self.root/'out.bin')

    def test_missing_report_box_is_rejected(self):
        self.make(self.xml.replace(b'id="2"',b'id="99"'))
        with self.assertRaises(LayoutError):fit_report_body(self.source,self.target)

    def test_duplicate_report_box_is_rejected(self):
        tree=E.fromstring(self.xml)
        shapes=tree.find('p:cSld/p:spTree',NS)
        shapes.append(copy.deepcopy(shapes[0]))
        self.make(E.tostring(tree))
        with self.assertRaises(LayoutError):fit_report_body(self.source,self.target)

    def test_does_not_reduce_below_twelve(self):
        self.make(self.xml.replace(b'1400',b'1200'))
        with self.assertRaises(LayoutError):fit_report_body(self.source,self.target)
        self.assertFalse(self.target.exists())

    def test_other_sizes_are_not_invented(self):
        self.make(self.xml.replace(b'1400',b'1300'))
        with self.assertRaises(LayoutError):fit_report_body(self.source,self.target)

    def test_reparse_source_is_rejected(self):
        link=self.root/'link.pptx'
        try:link.symlink_to(self.source)
        except OSError:self.skipTest('This Windows account cannot create symlinks')
        with self.assertRaises(LayoutError):fit_report_body(link,self.target)


class NativeOverflowTests(unittest.TestCase):
    def setUp(self):
        self.meta={'nativePowerPoint':True,'slides':2,'overflows':[{
            'slide':2,'id':2,'width':500.0,'height':700.0,'boundWidth':490.0,'boundHeight':720.0}]}

    def test_only_report_overflow_is_eligible(self):
        self.assertTrue(report_only_overflow(self.meta))

    def test_any_other_overflow_blocks_fitting(self):
        self.meta['overflows'].append({**self.meta['overflows'][0],'slide':1})
        self.assertFalse(report_only_overflow(self.meta))

    def test_invalid_native_measurements_are_not_trusted(self):
        for key,value in [('nativePowerPoint',False),('slides',1),('overflows',[]),('overflows',{})]:
            with self.subTest(key=key):
                data=copy.deepcopy(self.meta);data[key]=value
                self.assertFalse(report_only_overflow(data))

    def test_bad_numbers_and_shape_identity_are_rejected(self):
        for key,value in [('slide',True),('id',True),('id',3),('boundHeight',float('nan')),('boundWidth',-1),('height','700')]:
            with self.subTest(key=key,value=value):
                data=copy.deepcopy(self.meta);data['overflows'][0][key]=value
                self.assertFalse(report_only_overflow(data))

    def test_false_overflow_is_not_used_to_reduce_font(self):
        self.meta['overflows'][0]['boundHeight']=690
        self.assertFalse(report_only_overflow(self.meta))


if __name__=='__main__':unittest.main()
