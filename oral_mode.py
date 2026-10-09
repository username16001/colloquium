"""Interactive preparation using the same bank as generator.py, offline."""
import base64,json,pathlib,random,re
from urllib.parse import urlsplit
from question_data import markdown,format_code
ROOT=pathlib.Path(__file__).resolve().parent

def generate_oral(questions,output,count=9,seed=None):
    rows=[]
    for q in questions:
        if q.get('duplicate_of') or q.get('review',{}).get('status')=='excluded':continue
        answer=q.get('correction') or q['answer']
        rows.append({**{k:q[k] for k in ['id','lecture','topic','type','difficulty','question','environment','origin']},'code':q['code'],'codeHtml':format_code(q['code']) if q['code'] else '', 'answerHtml':markdown(answer),'explanationHtml':markdown(q['explanation']),'originalAnswerHtml':markdown(q['answer']) if q.get('correction') else '', 'source':q['source'],'review':q.get('review',{})})
    initial=random.Random(seed).sample(rows,min(count,len(rows)))
    voice_config=json.loads((ROOT/'voice_config.json').read_text(encoding='utf-8'))
    endpoint=voice_config.get('endpoint','')
    if not isinstance(endpoint,str):raise ValueError('Voice endpoint must be a string')
    provider=voice_config.get('provider','groq')
    if provider not in {'groq','anthropic','routerai'}:raise ValueError('Unknown voice grading provider')
    if endpoint:
        url=urlsplit(endpoint)
        if not url.hostname or url.username or url.password or url.scheme!='https' and not (url.scheme=='http' and url.hostname in {'localhost','127.0.0.1'}):
            raise ValueError('Voice endpoint must use HTTPS (localhost is allowed for development)')
    data=json.dumps({'questions':rows,'count':min(100,count),'totalRecords':len(questions),'seed':seed,'initialIds':[q['id'] for q in initial],'version':'2.1.0','voiceEndpoint':endpoint,'voiceProvider':provider},ensure_ascii=False).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')
    template=(ROOT/'oral_template.html').read_text(encoding='utf-8')
    # Inline our modules and math assets: the familiar HTML remains autonomous.
    def bundle(name):
        source=(ROOT/'web'/f'{name}.mjs').read_text(encoding='utf-8')
        exports=re.findall(r'^export (?:const|function|async function) (\w+)',source,re.M)
        source=re.sub(r"^import (\{.*?\}) from './(\w+).mjs';",lambda m:'const '+m[1]+' = '+m[2].title()+';',source,flags=re.M)
        source=re.sub(r'^export ', '', source, flags=re.M)
        return f'const {name.title()} = (()=>{{\n{source}\nreturn {{'+','.join(exports)+'};\n})();\n'
    app=(ROOT/'web/app.mjs').read_text(encoding='utf-8')
    app=re.sub(r"^import (\{.*?\}) from './(\w+).mjs';",lambda m:'const '+m[1]+' = '+m[2].title()+';',app,flags=re.M)
    app=bundle('voice')+bundle('study')+bundle('storage')+bundle('updates')+app
    vendor=ROOT/'web/vendor/katex'
    math_css=(vendor/'katex.min.css').read_text(encoding='utf-8')
    math_css=re.sub(r',url\(fonts/[^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)','',math_css)
    math_css=re.sub(r'url\(fonts/([^)]+\.woff2)\)',lambda m:'url(data:font/woff2;base64,'+base64.b64encode((vendor/'fonts'/m[1]).read_bytes()).decode()+')',math_css)
    math_js=(vendor/'katex.min.js').read_text(encoding='utf-8')+'\n'+(vendor/'auto-render.min.js').read_text(encoding='utf-8')
    template=template.replace('</head>','<!-- KaTeX license\n'+(vendor/'LICENSE').read_text(encoding='utf-8')+'\n--></head>')
    for key,value in {'BANK':data,'STYLE':(ROOT/'web/app.css').read_text(encoding='utf-8'),'APP_SCRIPT':app,'MATH_STYLE':math_css,'MATH_SCRIPT':math_js}.items():
        template=template.replace('/*__'+key+'__*/',value)
    pathlib.Path(output).write_text(template,encoding='utf-8')
