"""Build a portable static PWA using Python's standard library only."""
import argparse,hashlib,json,pathlib,shutil,struct,zlib
import random
from generator import generate_html,select_random_questions
from oral_mode import generate_oral
from question_data import load_bank,to_topics
ROOT=pathlib.Path(__file__).resolve().parent

def png_icon(size):
    data=bytearray()
    for y in range(size):
        data.append(0)
        for x in range(size):
            u,v=x/size,y/size
            color=(22,120,102)
            # Code chevrons and underline, entirely inside the maskable safe area.
            if .28<u<.43 and abs(abs(v-.5)-(u-.28)*1.2)<.022:color=(255,245,233)
            if .57<u<.72 and abs(abs(v-.5)-(.72-u)*1.2)<.022:color=(255,245,233)
            if .36<u<.61 and .71<v<.75:color=(255,180,135)
            data.extend(color)
    def chunk(name,payload):return struct.pack('>I',len(payload))+name+payload+struct.pack('>I',zlib.crc32(name+payload)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(data,9))+chunk(b'IEND',b'')

def build(output=None):
    qs=load_bank();generate_oral(qs,ROOT/'oral_questions.html',9,11)
    random.seed(11)
    generate_html(select_random_questions(to_topics(qs)),ROOT/'exam_questions.html')
    (ROOT/'index.html').write_bytes((ROOT/'oral_questions.html').read_bytes())
    icons=ROOT/'icons';icons.mkdir(exist_ok=True)
    for name,size in [('icon-192.png',192),('icon-512.png',512),('apple-touch-icon.png',180)]:
        (icons/name).write_bytes(png_icon(size))
    (icons/'icon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#167866"/><path d="M25 23l-9 9 9 9m14-18l9 9-9 9" fill="none" stroke="#fff5e9" stroke-width="4"/><path d="M26 49h14" stroke="#ffb487" stroke-width="4"/></svg>',encoding='utf-8')
    manifest={'id':'./','name':'Коллоквиум · Python','short_name':'Коллоквиум','lang':'ru','description':'Устная подготовка и интервальное повторение по 14 лекциям Python','start_url':'./index.html','scope':'./','display':'standalone','background_color':'#f5f6f8','theme_color':'#167866','icons':[{'src':'./icons/icon-192.png','sizes':'192x192','type':'image/png','purpose':'any maskable'},{'src':'./icons/icon-512.png','sizes':'512x512','type':'image/png','purpose':'any maskable'}]}
    (ROOT/'manifest.webmanifest').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    assets=['index.html','oral_questions.html','exam_questions.html','manifest.webmanifest','icons/icon.svg','icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png']
    digest=hashlib.sha256()
    for name in assets:digest.update((ROOT/name).read_bytes())
    sw=(ROOT/'web/sw.template.js').read_text(encoding='utf-8').replace('/*__VERSION__*/',digest.hexdigest()[:16]).replace('/*__RESOURCES__*/',json.dumps(['./'+name for name in assets]))
    (ROOT/'sw.js').write_text(sw,encoding='utf-8')
    target=pathlib.Path(output or ROOT/'dist').resolve()
    if target==ROOT or not target.is_relative_to(ROOT):raise ValueError('Build output must be a subdirectory of the project')
    target.mkdir(parents=True,exist_ok=True)
    for name in assets+['sw.js']:
        dest=target/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/name,dest)
    print('PWA built:',target,'—',len(qs),'records; offline resources:',len(assets))
    return target

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=pathlib.Path)
    build(parser.parse_args().output)
