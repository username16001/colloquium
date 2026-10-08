"""Update the generated section of docs/QUESTIONS.md from the working JSON bank."""
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = b'<!-- BEGIN GENERATED QUESTIONS -->'
LEVELS = ['Простые','Средние','Сложные']


def sync():
    bank = json.loads((ROOT/'questions.json').read_text(encoding='utf-8'))['questions']
    path = ROOT/'docs/QUESTIONS.md'
    prefix = path.read_bytes().split(MARKER)[0]
    lines = ['<!-- BEGIN GENERATED QUESTIONS -->','', '# Дополнение: 300 вопросов по лекциям 1–14','',
             'Экспорт из questions.json. Исходные вопросы выше относятся к прошлому коллоквиуму; новые составлены по лекциям. Индексы source.cells отсчитываются с нуля.','']
    for lecture in range(1,15):
        rows = [q for q in bank if q['origin']=='new' and q['lecture']==lecture]
        name = Path(rows[0]['source']['notebook']).stem
        lines += [f'## Лекция {lecture:02d}. {name}','']
        for level in LEVELS:
            lines += [f'### {level} вопросы','']
            for q in rows:
                if q['difficulty']!=level:continue
                lines += ['<details>', '<summary><b>'+html.escape(q['question'])+'</b></summary>', '<!-- question-id:'+q['id']+' -->','',
                          '**Ответ:** '+q['answer'],'','**Объяснение:** '+q['explanation'],'',
                          f"Тема: {q['topic']}; лекция: {lecture}; тип: {q['type']}; среда: {q['environment']}",'',
                          f"Источник: {q['source']['notebook']}; ячейки: {', '.join(map(str,q['source']['cells']))}. Проверка: {q.get('review',{}).get('status','needs_review')}.",'</details>','']
                if q['code']:lines += ['```python',q['code'],'```','']
            lines += ['---','']
    path.write_bytes(prefix + ('\n'.join(lines)+'\n').encode('utf-8'))
    print('docs/QUESTIONS.md: 300 new records synchronized')

if __name__=='__main__':sync()
