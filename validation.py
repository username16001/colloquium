"""Structural and source validation; semantic review remains a separate task."""
import ast,collections,json,pathlib,re
from question_data import LEVELS,TYPE_ALIASES
ROOT=pathlib.Path(__file__).resolve().parent

def validate_bank(data,lecture_root=None,strict_sources=False):
    errors=[];warnings=[];rows=data.get('questions') if isinstance(data,dict) else None
    def issue(target,q,field,message):target.append({'id':q.get('id','?') if isinstance(q,dict) else '?','field':field,'message':message})
    if not isinstance(data,dict) or type(data.get('schema_version')) is not int or data.get('schema_version')!=1 or not isinstance(rows,list):
        return {'errors':[{'id':'?','field':'schema_version','message':'Expected schema_version 1 and questions array'}],'warnings':[],'stats':{}}
    ids={};keys={};notebook_cache={};lecture_root=pathlib.Path(lecture_root or ROOT/'lectures')
    inventory_path=ROOT/'audit/lecture_inventory.json'
    inventory=json.loads(inventory_path.read_text(encoding='utf-8')) if inventory_path.exists() else {}
    for q in rows:
        if not isinstance(q,dict):issue(errors,q,'record','Record must be an object');continue
        for field in ['id','question','answer','explanation','code','topic','type','difficulty','environment','origin']:
            if not isinstance(q.get(field),str):issue(errors,q,field,'Required string');continue
            if field not in ['code','answer','explanation'] and not q[field].strip():issue(errors,q,field,'Empty value')
        ident=q.get('id')
        if isinstance(ident,str):
            if not re.fullmatch(r'[ON]\d{2}-(?:\d-)?\d{3}',ident):issue(errors,q,'id','Unknown ID format')
            if ident in ids:issue(errors,q,'id','Duplicate ID')
            ids[ident]=q
        if type(q.get('lecture')) is not int or not 1<=q['lecture']<=14:issue(errors,q,'lecture','Expected integer 1–14')
        if q.get('difficulty') not in LEVELS:issue(errors,q,'difficulty','Unknown difficulty')
        if q.get('type') not in TYPE_ALIASES.values():issue(errors,q,'type','Unknown question type')
        if q.get('origin') not in ['original','new']:issue(errors,q,'origin','Unknown origin')
        if 'review' in q and not isinstance(q['review'],dict):issue(errors,q,'review','Expected object')
        new=q.get('origin')=='new'
        if not str(q.get('answer','')).strip():issue(errors if new else warnings,q,'answer','Missing answer; legacy correction may be separate')
        if new and not str(q.get('explanation','')).strip():issue(errors,q,'explanation','New questions require an explanation')
        code=q.get('code')
        if new and isinstance(code,str) and code:
            try:ast.parse(code)
            except SyntaxError as e:issue(errors,q,'code',f'Invalid syntax: {e.msg}')
            if not isinstance(q.get('expected_stdout'),str):issue(errors,q,'expected_stdout','Code requires expected stdout')
            if 'expected_exception' not in q or q.get('expected_exception') is not None and not isinstance(q['expected_exception'],str):issue(errors,q,'expected_exception','Required string or null')
        if new and not code and re.search(r'код (?:выше|ниже)|данн(?:ый|ого) (?:код|фрагмент)|что (?:выведет|напечатает)',str(q.get('question','')),re.I):issue(warnings,q,'question','Possible missing code: editorial review required')
        if isinstance(q.get('question'),str) and isinstance(code,str):
            key=(re.sub(r'\s+',' ',q['question']).strip().casefold(),code.strip())
            if key in keys and q.get('duplicate_of')!=keys[key]['id'] and keys[key].get('duplicate_of')!=ident:issue(errors,q,'question','Unmarked exact duplicate')
            else:keys[key]=q
        source=q.get('source')
        if not isinstance(source,dict):issue(errors,q,'source','Required object');continue
        if new:
            notebook=source.get('notebook');cells=source.get('cells')
            if not isinstance(notebook,str) or not notebook.endswith('.ipynb') or '\\' in notebook or ':' in notebook or pathlib.PurePosixPath(notebook).is_absolute() or '..' in pathlib.PurePosixPath(notebook).parts:
                issue(errors,q,'source.notebook','Invalid notebook path');continue
            if not isinstance(cells,list) or not cells or any(type(c) is not int or c<0 for c in cells):issue(errors,q,'source.cells','Expected nonempty array of nonnegative integer indices');continue
            path=lecture_root/pathlib.PurePosixPath(notebook).name
            if path.is_file():
                try:
                    if path not in notebook_cache:notebook_cache[path]=len(json.loads(path.read_text(encoding='utf-8'))['cells'])
                    count=notebook_cache[path]
                except (ValueError,KeyError,TypeError):issue(errors,q,'source','Unreadable notebook');continue
            else:
                issue(errors if strict_sources else warnings,q,'source.notebook','Notebook unavailable; inventory is not a replacement for content review')
                count=inventory.get(path.name,{}).get('cells',0)
            if any(c>=count for c in cells):issue(errors,q,'source.cells','Cell index outside available notebook/inventory')
            review=q.get('review')
            if not isinstance(review,dict) or 'status' not in review:issue(warnings,q,'review','Editorial review status missing')
            elif review['status'] not in ['reviewed','needs_review','excluded']:issue(errors,q,'review.status','Unknown editorial status')
        else:
            path=ROOT/str(source.get('file',''))
            if not isinstance(source.get('file'),str) or not source['file'] or not path.is_file() or not path.resolve().is_relative_to(ROOT):issue(errors,q,'source.file','Original source file unavailable')
    for q in rows:
        if isinstance(q,dict) and q.get('duplicate_of'):
            target=ids.get(q['duplicate_of']) if isinstance(q['duplicate_of'],str) else None
            if not target:issue(errors,q,'duplicate_of','Target does not exist')
            elif any(not isinstance(r.get(k),str) for r in [q,target] for k in ['question','code']):issue(errors,q,'duplicate_of','Cannot compare malformed records')
            elif q is target or target.get('duplicate_of') or (re.sub(r'\s+',' ',q['question']).strip().casefold(),q['code'].strip()) != (re.sub(r'\s+',' ',target['question']).strip().casefold(),target['code'].strip()):issue(errors,q,'duplicate_of','Target must be the same question and code, without a duplicate chain')
    return {'errors':errors,'warnings':warnings,'stats':{'records':len(rows),'original':sum(q.get('origin')=='original' for q in rows if isinstance(q,dict)),'new':sum(q.get('origin')=='new' for q in rows if isinstance(q,dict)),'available':sum(not q.get('duplicate_of') and (q.get('review') or {}).get('status')!='excluded' for q in rows if isinstance(q,dict) and isinstance(q.get('review',{}),dict))}}
