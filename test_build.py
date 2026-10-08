import json,pathlib,re,tempfile,unittest
from build_pwa import build
ROOT=pathlib.Path(__file__).resolve().parent

class BuildTests(unittest.TestCase):
    def test_portable_build_and_all_offline_resources(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as d:
            target=build(d);page=(target/'index.html').read_text(encoding='utf-8');worker=(target/'sw.js').read_text(encoding='utf-8')
            self.assertEqual((target/'index.html').read_bytes(),(target/'oral_questions.html').read_bytes())
            self.assertNotIn('/*__',page);self.assertNotIn('/*__',worker);self.assertNotIn('startTimer',page)
            self.assertNotIn('https://cdn',page);self.assertIn('data:font/woff2;base64,',page)
            manifest=json.loads((target/'manifest.webmanifest').read_text(encoding='utf-8'))
            for field in ['id','start_url','scope']:self.assertTrue(manifest[field].startswith('./'))
            assets=json.loads(re.search(r'const RESOURCES = (.*?);',worker)[1])
            for asset in assets:self.assertTrue((target/asset).is_file(),asset)
            config=json.loads(re.search(r'const config=(.*?);\nconst bank=',page,re.S)[1]);self.assertEqual(config['totalRecords'],438);self.assertEqual(len(config['questions']),437)

if __name__=='__main__':unittest.main()
