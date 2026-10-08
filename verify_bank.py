"""Validate bank/schema; --execute checks curated new code, never legacy fragments."""
import argparse, ast, collections, concurrent.futures, hashlib, json, os, pathlib, re, subprocess, sys, tempfile
ROOT=pathlib.Path(__file__).resolve().parent
ALLOWED_IMPORTS={'array','copy','collections','functools','typing','abc','enum','dataclasses','contextlib','warnings','itertools','heapq','random','numpy','pandas','pytest','json','csv','io','datetime','pathlib'}
def check_bank():
    qs=json.loads((ROOT/'questions.json').read_text(encoding='utf-8'))['questions']
    assert len(qs)==438
    original=[q for q in qs if q['origin']=='original'];new=[q for q in qs if q['origin']=='new']
    assert len(original)==138 and len(new)==300
    assert len({q['id'] for q in qs})==438
    keys=set();counts=collections.Counter()
    for q in new:
        for field in ['question','answer','explanation','topic','type','difficulty','environment']:
            assert isinstance(q[field],str) and q[field].strip(),(q['id'],field)
        assert 1<=q['lecture']<=14 and q['source']['cells']
        key=(re.sub(r'\s+',' ',q['question']).strip(),q['code'].strip())
        assert key not in keys,('duplicate',q['id'])
        keys.add(key);counts[q['lecture']]+=1
        if q['code']:
            assert isinstance(q['expected_stdout'],str)
            tree=ast.parse(q['code'])
            for node in ast.walk(tree):
                if isinstance(node,(ast.Import,ast.ImportFrom)):
                    names=[x.name for x in node.names] if isinstance(node,ast.Import) else [node.module or '']
                    assert all(x.split('.')[0] in ALLOWED_IMPORTS for x in names),(q['id'],names)
                if isinstance(node,ast.Call) and isinstance(node.func,ast.Name):
                    assert node.func.id not in {'open','eval','exec','compile','input','__import__'},q['id']
    assert len(counts)==14 and min(counts.values())>=18 and max(counts.values())<=24
    manifest=json.loads((ROOT/'originals/manifest.json').read_text(encoding='utf-8'))
    for name,digest in manifest.items():
        assert hashlib.sha256((ROOT/'originals'/name).read_bytes()).hexdigest()==digest
    assert (ROOT/'originals/README.md').read_bytes() in (ROOT/'docs/QUESTIONS.md').read_bytes()
    from validation import validate_bank
    validation=validate_bank({'schema_version':1,'questions':qs})
    assert not validation['errors'],validation['errors']
    original_hashes=json.loads((ROOT/'audit/original_records.sha256.json').read_text(encoding='utf-8'))
    for q in original:assert hashlib.sha256(json.dumps(q,ensure_ascii=False,sort_keys=True).encode()).hexdigest()==original_hashes[q['id']],q['id']
    return qs

def execute_one(q,python,deps):
    with tempfile.TemporaryDirectory(prefix='.verify-',dir=ROOT) as d:
        path=pathlib.Path(d)/'question.json';path.write_text(json.dumps(q),encoding='utf-8')
        try:
            result=subprocess.run([python,'-I',str(ROOT/'_verify_worker.py'),str(path),*deps],cwd=d,capture_output=True,text=True,encoding='utf-8',timeout=30)
        except subprocess.TimeoutExpired:
            return dict(id=q['id'],ok=False,process_error='Wall-clock timeout (30 seconds)')
        if result.returncode:return dict(id=q['id'],ok=False,process_error=result.stderr[-2000:])
        actual=json.loads(result.stdout)
        ok=actual['stdout']==q['expected_stdout'] and actual['exception']==q['expected_exception']
        return dict(id=q['id'],ok=ok,actual=actual,expected={'stdout':q['expected_stdout'],'exception':q['expected_exception']},stderr=result.stderr[-1000:])

def main():
    p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');p.add_argument('--python',default=sys.executable);p.add_argument('--deps',action='append',default=[])
    p.add_argument('--output',type=pathlib.Path,help='Путь отчёта; без --execute по умолчанию verification_schema.json')
    a=p.parse_args()
    qs=check_bank();results=[]
    if a.execute:
        code=[q for q in qs if q['origin']=='new' and q['code']]
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            results=list(pool.map(lambda q:execute_one(q,a.python,[str(pathlib.Path(x).resolve()) for x in a.deps]),code))
    report={'python':sys.version,'platform':sys.platform,'execution_requested':a.execute,'records':len(qs),'new':300,'original':138,'by_lecture':dict(collections.Counter(q['lecture'] for q in qs)),'new_by_type':dict(collections.Counter(q['type'] for q in qs if q['origin']=='new')),'code_results':results}
    report['limits']='Windows Job Object: CPU 5s, memory 1GiB, one process; audit denies filesystem writes' if os.name=='nt' else 'Unix resource: CPU 5s, file size 1MiB'
    report['limits']+='; wall-clock timeout 30s; output 1MiB; AST and audit checks; only reviewed new examples'
    report['bank_sha256']=hashlib.sha256((ROOT/'questions.json').read_bytes()).hexdigest()
    output=a.output or ROOT/('verification_current.json' if a.execute else 'verification_schema.json')
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    bad=[r for r in results if not r['ok']]
    print('Schema/archives OK; executed',len(results),'failed',len(bad))
    for r in bad:print(json.dumps(r,ensure_ascii=False))
    return bool(bad)
if __name__=='__main__':raise SystemExit(main())
