import importlib.util,json,os,pathlib,random,re,subprocess,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
import generator
from question_data import load_bank,filter_bank,to_topics,question_key,markdown
from oral_mode import generate_oral
class GeneratorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bank=load_bank();cls.topics=to_topics(cls.bank)
    def test_original_parser_preservation(self):
        spec=importlib.util.spec_from_file_location('original',ROOT/'originals/generator.py');old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
        original=old.parse_readme(ROOT/'originals/README.md');current=generator.parse_readme(ROOT/'docs/QUESTIONS.md')
        self.assertEqual(sum(len(x) for lv in original.values() for x in lv.values()),138)
        for topic,levels in original.items():self.assertEqual(current[topic],levels)
        self.assertEqual(sum(len(x) for lv in current.values() for x in lv.values()),438)
    def test_distribution(self):
        from collections import Counter
        new=[q for q in self.bank if q['origin']=='new']
        self.assertEqual(len(new),300)
        self.assertEqual(sorted(Counter(q['type'] for q in new).values()),[45,45,45,75,90])
        self.assertEqual(set(q['lecture'] for q in new),set(range(1,15)))
    def test_selection_no_duplicates_many_seeds(self):
        for seed in range(100):
            random.seed(seed);selected=generator.select_random_questions(self.topics)
            keys=[question_key(raw) for group in selected.values() for _,raw in group]
            self.assertEqual(len(keys),9);self.assertEqual(len(set(keys)),9)
    def test_duplicate_across_levels_in_direct_parser(self):
        topics=generator.parse_readme(ROOT/'docs/QUESTIONS.md')
        selected=generator.select_random_questions(topics,1000,1000,1000,1000)
        keys=[question_key(raw) for group in selected.values() for _,raw in group]
        self.assertEqual(len(keys),437);self.assertEqual(len(keys),len(set(keys)))
    def test_filters(self):
        qs=filter_bank(self.bank,{3,4},{'code'},{'Средние'})
        self.assertTrue(qs)
        self.assertTrue(all(q['lecture'] in {3,4} and q['type']=='Понимание кода' and q['difficulty']=='Средние' for q in qs))
    def test_all_lecture_filters(self):
        for n in range(1,15):
            self.assertTrue(filter_bank(self.bank,{n}))
    def test_empty_filter(self):
        self.assertEqual(filter_bank(self.bank,{99}),[])
    def test_small_bank_no_repeat(self):
        selected=generator.select_random_questions(to_topics(self.bank[:1]))
        self.assertEqual(sum(map(len,selected.values())),1)
    def test_code_escape_and_whitespace(self):
        code='if x < y and y > 0:\n    print("<tag>&")'
        result=generator.format_code_with_line_numbers(code)
        self.assertNotIn('<tag>',result)
        import html
        lines=re.findall(r'<span class="line-content">(.*?)</span></div>',result,re.S)
        self.assertEqual('\n'.join(html.unescape(re.sub(r'<[^>]+>','',line)) for line in lines),code)
        self.assertIn('tok-keyword',result)
    def test_answer_code_not_exposed(self):
        text='<details><summary>Question</summary>```python\nprint("secret")\n```</details>\n```python\nprint("task")\n```'
        rendered=markdown(text)
        self.assertNotIn('\x00',rendered)
        self.assertLess(rendered.index('secret'),rendered.index('</details>'))
        self.assertGreater(rendered.index('task'),rendered.index('</details>'))
    def test_corrections_visible(self):
        q=next(q for q in self.bank if q['id']=='O07-2-001')
        from question_data import legacy_block
        self.assertIn('Исправление исходного ответа',legacy_block(q))
    def test_all_markdown_no_unresolved_tokens(self):
        from question_data import legacy_block
        for q in self.bank:self.assertNotIn('\x00',markdown(legacy_block(q)))
    def test_html_finish_and_scores_without_timer(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as d:
            p=pathlib.Path(d)/'exam.html';generator.generate_html(generator.select_random_questions(self.topics),p);s=p.read_text(encoding='utf-8')
            for token in ['finishExam','calculateTotal','score_extra_','<details>']:self.assertIn(token,s)
            self.assertNotIn('cdnjs',s)
            self.assertNotIn('startTimer',s);self.assertNotIn('timerInterval',s)
            self.assertIn('body:not(.exam-finished)',s)
    def test_oral_embeds_all_questions_once(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as d:
            p=pathlib.Path(d)/'oral.html';generate_oral(self.bank,p,9,42);s=p.read_text(encoding='utf-8')
            data=json.loads(re.search(r'const config=(.*?);\nconst bank=',s,re.S)[1])
            self.assertEqual(len(data['questions']),437)
            self.assertEqual(len(set(data['initialIds'])),9)
            self.assertNotIn('/*__BANK__*/',s)
    def test_cli_from_other_directory(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as d:
            r=subprocess.run([sys.executable,str(ROOT/'generator.py'),'--seed','5'],cwd=d,capture_output=True,text=True,encoding='utf-8',env={**os.environ,'PYTHONIOENCODING':'utf-8'})
            self.assertEqual(r.returncode,0,r.stdout+r.stderr)
            self.assertTrue((pathlib.Path(d)/'exam_questions.html').exists())
    def test_bad_cli_returns_error(self):
        r=subprocess.run([sys.executable,str(ROOT/'generator.py'),'--lectures','99'],capture_output=True,text=True,encoding='utf-8',env={**os.environ,'PYTHONIOENCODING':'utf-8'})
        self.assertNotEqual(r.returncode,0);self.assertIn('Ошибка',r.stdout)
    def test_source_cells_exist(self):
        root=ROOT/'lectures'
        if not root.exists():self.skipTest('Source lecture repository unavailable')
        for q in self.bank:
            if q['origin']!='new':continue
            cells=json.loads((root/pathlib.PurePosixPath(q['source']['notebook']).name).read_text(encoding='utf-8'))['cells']
            self.assertTrue(all(0<=c<len(cells) for c in q['source']['cells']),q['id'])
    def test_question_collection_export_matches_bank(self):
        import html
        text=(ROOT/'docs/QUESTIONS.md').read_text(encoding='utf-8')
        for q in self.bank:
            if q['origin']!='new':continue
            marker='<!-- question-id:'+q['id']+' -->'
            self.assertEqual(text.count(marker),1,q['id'])
            pos=text.index(marker);start=text.rfind('<details>',0,pos);end=text.index('</details>',pos)
            block=text[start:end]
            title=re.search(r'<summary><b>(.*?)</b></summary>',block,re.S)
            self.assertIsNotNone(title,q['id']);self.assertEqual(html.unescape(title[1]),q['question'],q['id'])
            self.assertIn('**Ответ:** '+q['answer'],block,q['id'])
            self.assertIn('**Объяснение:** '+q['explanation'],block,q['id'])
            if q['code']:
                code=re.match(r'\s*```python\n(.*?)\n```',text[end+len('</details>'):],re.S)
                self.assertIsNotNone(code,q['id']);self.assertEqual(code[1],q['code'],q['id'])
    def test_deck_shuffle_requires_index_assignment(self):
        class Deck:
            def __init__(self):self._cards=['A','K','Q'];self.writes=0
            def __len__(self):return len(self._cards)
            def __getitem__(self,index):return self._cards[index]
        deck=Deck()
        with self.assertRaises(TypeError):random.Random(42).shuffle(deck)
        self.assertEqual(deck._cards,['A','K','Q'])
        def assign(self,index,value):self.writes+=1;self._cards[index]=value
        Deck.__setitem__=assign
        self.assertIsNone(random.Random(42).shuffle(deck))
        self.assertEqual(sorted(deck._cards),['A','K','Q'])
        self.assertGreater(deck.writes,0)
if __name__=='__main__':unittest.main()
