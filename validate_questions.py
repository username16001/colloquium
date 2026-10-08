import argparse,json,pathlib
from validation import validate_bank,ROOT

def main():
    p=argparse.ArgumentParser(description='Validate structure and source links; not a semantic proof')
    p.add_argument('--bank',type=pathlib.Path,default=ROOT/'questions.json');p.add_argument('--lecture-root',type=pathlib.Path);p.add_argument('--strict-sources',action='store_true');p.add_argument('--output',type=pathlib.Path)
    a=p.parse_args();report=validate_bank(json.loads(a.bank.read_text(encoding='utf-8')),a.lecture_root,a.strict_sources)
    if a.output:a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Validation:',report['stats'],'errors:',len(report['errors']),'warnings:',len(report['warnings']))
    for issue in report['errors']+report['warnings'][:10]:print(issue['id'],issue['field'],issue['message'])
    return bool(report['errors'])

if __name__=='__main__':raise SystemExit(main())
