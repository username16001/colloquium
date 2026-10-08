"""Fetch pinned KaTeX browser assets from the official npm registry. Optional setup."""
import hashlib
import io
import json
import tarfile
import urllib.request
from pathlib import Path

VERSION = '0.16.22'
ROOT = Path(__file__).resolve().parents[1]

def main():
    url = f'https://registry.npmjs.org/katex/-/katex-{VERSION}.tgz'
    blob = urllib.request.urlopen(url, timeout=60).read()
    target = ROOT / 'web/vendor/katex'
    target.mkdir(parents=True, exist_ok=True)
    selected = {'dist/katex.min.js', 'dist/katex.min.css', 'dist/contrib/auto-render.min.js', 'LICENSE'}
    files = []
    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:gz') as archive:
        for member in archive.getmembers():
            relative = member.name.removeprefix('package/')
            if not member.isfile() or not (relative in selected or relative.startswith('dist/fonts/')):
                continue
            name = relative.removeprefix('dist/').replace('contrib/', '')
            path = target / name
            assert path.resolve().is_relative_to(target.resolve())
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(archive.extractfile(member).read())
            files.append(name)
    (target / 'provenance.json').write_text(json.dumps({'version': VERSION, 'url': url, 'sha256': hashlib.sha256(blob).hexdigest(), 'files': files}, indent=2)+'\n', encoding='utf-8')
    print('KaTeX', VERSION, ':', len(files), 'assets vendored')

if __name__ == '__main__':
    main()
