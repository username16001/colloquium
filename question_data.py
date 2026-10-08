"""Bank metadata and compatibility with the existing Markdown/HTML generator."""
import builtins,html,io,json,keyword,pathlib,re,token,tokenize
ROOT=pathlib.Path(__file__).resolve().parent
LEVELS=['Простые','Средние','Сложные']
TYPE_ALIASES={'theory':'Теория','code':'Понимание кода','deep':'Глубокое понимание','algorithm':'Алгоритм / формула / доказательство','tricky':'Нестандартный случай / ошибка'}

def load_bank(path=None):
    data=json.loads(pathlib.Path(path or ROOT/'questions.json').read_text(encoding='utf-8'))
    from validation import validate_bank
    report=validate_bank(data)
    if report['errors']:
        item=report['errors'][0]
        raise ValueError(f"Некорректная база: {item['id']} / {item['field']}: {item['message']}")
    return data['questions']

def filter_bank(qs,lectures=None,types=None,difficulties=None):
    types={TYPE_ALIASES.get(t,t) for t in types or []}
    return [q for q in qs if (not lectures or q['lecture'] in lectures) and (not types or q['type'] in types) and (not difficulties or q['difficulty'] in difficulties)]

def legacy_block(q):
    if q['origin']=='original':
        raw=q['legacy_block']
        if q.get('correction'):
            raw=raw.replace('</details>','\n\n**Исправление исходного ответа:** '+q['correction']+'\n</details>',1)
        return raw
    s=f'<details>\n<summary><b>{html.escape(q["question"])}</b></summary>\n\n**Ответ:** {q["answer"]}\n\n**Объяснение:** {q["explanation"]}\n</details>'
    if q['code']:s+='\n\n```python\n'+q['code']+'\n```'
    return s

def to_topics(qs):
    topics={}
    for q in qs:
        if q.get('duplicate_of') or q.get('review',{}).get('status')=='excluded':continue
        name=f'Лекция {q["lecture"]:02d}. {q["topic"]}'
        topic=topics.setdefault(name,{k:[] for k in LEVELS})
        topic[q['difficulty']].append(legacy_block(q))
    return topics

def question_key(raw):
    """Identity ignores answer and difficulty; legacy duplicate is sampled once."""
    m=re.search(r'<summary>(.*?)</summary>',raw,re.S)
    title=re.sub(r'<[^>]+>','',m[1] if m else raw).strip()
    end=raw.find('</details>')
    code=re.findall(r'```python\s*(.*?)\s*```',raw[end+10:] if end>=0 else raw,re.S)
    return re.sub(r'\s+',' ',html.unescape(title)),tuple(code)

def markdown(text):
    """Small offline renderer; protect code before formatting text."""
    tokens=[]
    def protect(fragment):
        key=f'\x00BLOCK{len(tokens)}\x00';tokens.append(fragment);return key
    def code(match):
        return protect(format_code(match.group(2)))
    text=re.sub(r'```([^\n`]*)\n(.*?)```',code,text,flags=re.S)
    def details(match):
        title=re.sub(r'<[^>]*>','',match.group(1)).strip()
        return protect('<details><summary>'+html.escape(html.unescape(title))+'</summary><div class="answer">'+markdown(match.group(2))+'</div></details>')
    text=re.sub(r'<details>\s*<summary>(.*?)</summary>\s*(.*?)\s*</details>',details,text,flags=re.S)
    text=re.sub(r'<!--.*?-->','',text,flags=re.S)
    text=html.escape(html.unescape(text))
    text=re.sub(r'`([^`\n]+)`',r'<code>\1</code>',text)
    text=re.sub(r'\*\*(.*?)\*\*',r'<strong>\1</strong>',text,flags=re.S)
    text=text.replace('\n','<br>')
    for i,fragment in reversed(list(enumerate(tokens))):text=text.replace(f'\x00BLOCK{i}\x00',fragment)
    return text

def format_code(code):
    lines=code.strip('\n').split('\n')
    segments={i:[] for i in range(1,len(lines)+1)}
    try:
        for t in tokenize.generate_tokens(io.StringIO('\n'.join(lines)).readline):
            cls=''
            if t.type==tokenize.STRING:cls='string'
            elif t.type==tokenize.NUMBER:cls='number'
            elif t.type==tokenize.COMMENT:cls='comment'
            elif t.type==tokenize.NAME and keyword.iskeyword(t.string):cls='keyword'
            elif t.type==tokenize.NAME and t.string in dir(builtins):cls='builtin'
            if not cls:continue
            for row in range(t.start[0],t.end[0]+1):
                if row not in segments:continue
                start=t.start[1] if row==t.start[0] else 0
                end=t.end[1] if row==t.end[0] else len(lines[row-1])
                segments[row].append((start,end,cls))
    except (tokenize.TokenError,IndentationError,SyntaxError):
        pass  # Syntax errors may be the subject of a legacy question.
    def highlighted(i,line):
        result='';position=0
        for start,end,cls in segments[i]:
            result+=html.escape(line[position:start])+f'<span class="tok-{cls}">'+html.escape(line[start:end])+'</span>'
            position=end
        return result+html.escape(line[position:])
    body=''.join(f'<div class="code-line"><span class="line-number">{i}</span><span class="line-content">{highlighted(i,line)}</span></div>' for i,line in enumerate(lines,1))
    return '<div class="code-block"><div class="code-lines">'+body+'</div></div>'
