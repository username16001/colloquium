import copy,hashlib,json,pathlib,subprocess,sys,tempfile,unittest,os
from validation import validate_bank
from question_data import load_bank
ROOT=pathlib.Path(__file__).resolve().parent

class ValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.bank=json.loads((ROOT/'questions.json').read_text(encoding='utf-8'))
    def test_original_records_unchanged(self):
        manifest=json.loads((ROOT/'audit/original_records.sha256.json').read_text(encoding='utf-8'))
        for q in self.bank['questions']:
            if q['origin']=='original':self.assertEqual(hashlib.sha256(json.dumps(q,ensure_ascii=False,sort_keys=True).encode()).hexdigest(),manifest[q['id']],q['id'])
    def test_editorial_review_covers_every_new_id(self):
        rows=[]
        for p in (ROOT/'audit').glob('review_*.json'):rows+=json.loads(p.read_text(encoding='utf-8'))['rows']
        self.assertEqual({r['id'] for r in rows},{q['id'] for q in self.bank['questions'] if q['origin']=='new'})
        self.assertEqual(len(rows),300)
        for row in rows:self.assertEqual(len(row['criteria']),10)
    def test_bank_valid_and_original_missing_answer_visible(self):
        report=validate_bank(self.bank,strict_sources=(ROOT/'lectures').is_dir())
        self.assertEqual(report['errors'],[]);self.assertEqual(report['stats']['available'],437)
        self.assertEqual([(r['id'],r['field']) for r in report['warnings'] if r['field']!='source.notebook'],[('O03-2-002','answer')])
    def test_bad_field_types_and_missing_fields(self):
        q=next(q for q in self.bank['questions'] if q['origin']=='new')
        for field,value in [('lecture',True),('type','Unknown'),('difficulty','easy'),('question',[]),('source',None),('answer',''),('explanation',''),('review','bad'),('review',{'status':'unknown'})]:
            bad=copy.deepcopy(q);bad[field]=value
            self.assertTrue(validate_bank({'schema_version':1,'questions':[bad]})['errors'],field)
    def test_invalid_source_indices_and_paths(self):
        q=next(q for q in self.bank['questions'] if q['origin']=='new')
        for source in [{'notebook':'../BasicTypes.ipynb','cells':[0]},{'notebook':'wrong.ipynb','cells':[0]},{'notebook':q['source']['notebook'],'cells':[-1]},{'notebook':q['source']['notebook'],'cells':[100000]}]:
            bad=copy.deepcopy(q);bad['source']=source
            self.assertTrue(validate_bank({'schema_version':1,'questions':[bad]},strict_sources=True)['errors'])
    def test_exact_duplicate_requires_valid_annotation(self):
        q=copy.deepcopy(next(q for q in self.bank['questions'] if q['origin']=='new'));other=copy.deepcopy(q);other['id']='N01-999'
        self.assertTrue(validate_bank({'schema_version':1,'questions':[q,other]})['errors'])
        other['duplicate_of']=q['id'];self.assertEqual(validate_bank({'schema_version':1,'questions':[q,other]})['errors'],[])
        other['question']='Other question';self.assertTrue(validate_bank({'schema_version':1,'questions':[q,other]})['errors'])
    def test_missing_code_warns_but_does_not_claim_semantic_proof(self):
        q=copy.deepcopy(next(q for q in self.bank['questions'] if q['origin']=='new'));q['question']='Что выведет данный код?';q['code']=''
        report=validate_bank({'schema_version':1,'questions':[q]});self.assertTrue(any(r['field']=='question' for r in report['warnings']))
    def test_loader_rejects_bad_bank_before_rendering(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as d:
            path=pathlib.Path(d)/'bank.json';path.write_text('{"schema_version":1,"questions":[{"id":"N01-001"}]}',encoding='utf-8')
            with self.assertRaises(ValueError):load_bank(path)
    def worker(self,code):
        with tempfile.TemporaryDirectory(dir=ROOT) as d:
            p=pathlib.Path(d)/'q.json';p.write_text(json.dumps({'id':'probe','code':code}),encoding='utf-8')
            result=subprocess.run([sys.executable,'-I',str(ROOT/'_verify_worker.py'),str(p)],cwd=d,capture_output=True,text=True,encoding='utf-8',timeout=12)
            self.assertEqual(result.returncode,0,result.stderr);return json.loads(result.stdout)
    def test_worker_blocks_network_and_file_writes(self):
        self.assertEqual(self.worker('import socket\nsocket.socket()')['exception'],'PermissionError')
        if os.name=='nt':self.assertEqual(self.worker('open("forbidden.txt", "w")')['exception'],'PermissionError')
        self.assertEqual(self.worker('import subprocess\nsubprocess.run(["echo", "test"])')['exception'],'PermissionError')
    def test_worker_limits_captured_output(self):
        self.assertEqual(self.worker('print("x" * (2*1024*1024))')['exception'],'OSError')
    @unittest.skipUnless(os.name=='nt','Windows Job Object test')
    def test_windows_cpu_limit_terminates_worker(self):
        script='import sys;sys.path.insert(0,'+repr(str(ROOT))+');from windows_limits import apply_limits;job=apply_limits(cpu_seconds=.25);print("limited",flush=True)\nwhile True: pass'
        result=subprocess.run([sys.executable,'-I','-c',script],capture_output=True,timeout=10)
        self.assertIn(b'limited',result.stdout)
        self.assertNotEqual(result.returncode,0)

if __name__=='__main__':unittest.main()
