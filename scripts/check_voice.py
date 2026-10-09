"""Manually smoke-test the deployed voice API with synthetic study answers.

Uses no provider key. Successful requests consume the configured provider's quota.
"""
import argparse
import json
import time
from pathlib import Path
import urllib.error
import urllib.request
import uuid
import re

ROOT = Path(__file__).resolve().parents[1]


def check_audio(endpoint, origin, path):
    """Use a synthetic test fixture only; never records the user's microphone."""
    audio = path.read_bytes()
    boundary = 'colloquium-' + uuid.uuid4().hex
    mime = 'audio/mp4' if path.suffix.lower() in ['.m4a', '.mp4'] else 'audio/wav'
    data = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="questionId"\r\n\r\nN01-001\r\n'
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="answer{path.suffix}"\r\n'
        f'Content-Type: {mime}\r\n\r\n'
    ).encode() + audio + f'\r\n--{boundary}--\r\n'.encode()
    request = urllib.request.Request(endpoint.removesuffix('/evaluate') + '/transcribe', method='POST',
        headers={'Origin': origin, 'Content-Type': 'multipart/form-data; boundary=' + boundary,
                 'User-Agent': 'python-colloquium-check/2.0'}, data=data)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        try:
            detail = json.load(error).get('error', 'API error')
        except (ValueError, AttributeError):
            detail = 'non-JSON response'
        raise SystemExit(f'audio: HTTP {error.code}: {detail}') from None
    text = result.get('text', '')
    if not isinstance(text, str) or not re.search(r'python|питон|пайтон', text, re.IGNORECASE):
        raise SystemExit('Audio transcription did not recognize the synthetic Python answer: ' + str(text))
    print(json.dumps({'case': 'audio', 'format': mime, 'text': text}, ensure_ascii=False), flush=True)
    print('Live audio transcription smoke check passed. Physical iPhone microphone is not tested.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', default='https://username16001.github.io')
    parser.add_argument('--delay', type=float, default=35, help='Pause between checks in seconds (0–60).')
    parser.add_argument('--case', choices=['all', 'incomplete', 'code', 'audio'], default='all')
    parser.add_argument('--expect-provider', choices=['groq', 'anthropic', 'routerai'])
    parser.add_argument('--audio-file', type=Path, default=ROOT / 'tests/fixtures/python-answer.wav')
    args = parser.parse_args()
    if not 0 <= args.delay <= 60:
        parser.error('--delay must be between 0 and 60 seconds')
    endpoint = json.loads((ROOT / 'voice_config.json').read_text(encoding='utf-8'))['endpoint']
    if not endpoint.startswith('https://'):
        raise SystemExit('Configure an HTTPS voice endpoint first.')
    if args.case == 'audio':
        check_audio(endpoint, args.origin, args.audio_file)
        return

    last_request = None

    def check(name, question_id, answer, decision, context='', retry=False):
        nonlocal last_request
        if last_request is not None:
            time.sleep(max(0, args.delay - (time.monotonic() - last_request)))
        last_request = time.monotonic()
        request = urllib.request.Request(endpoint, method='POST', headers={
            'Origin': args.origin, 'Content-Type': 'application/json', 'User-Agent': 'python-colloquium-check/2.0',
        }, data=json.dumps({'questionId': question_id, 'answer': answer, 'context': context}).encode())
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                body = json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 429 and not retry:
                try:
                    wait = min(60, max(1, int(error.headers.get('Retry-After', '60'))))
                except ValueError:
                    wait = 60
                print(f'{name}: rate limit; retrying once in {wait}s', flush=True)
                time.sleep(wait)
                return check(name, question_id, answer, decision, context, retry=True)
            # The Worker returns fixed, safe messages, never a provider key or upstream body.
            try:
                body = json.load(error)
                detail = body.get('error', 'API error')
            except (ValueError, AttributeError):
                detail = 'non-JSON response (' + str(error.headers.get('Content-Type', 'unknown content type')) + ')'
            raise SystemExit(f'{name}: HTTP {error.code}: {detail}') from None
        except (urllib.error.URLError, TimeoutError):
            raise SystemExit(f'{name}: connection failed') from None
        result = body.get('result', {})
        if args.expect_provider and body.get('provider') != args.expect_provider:
            raise SystemExit(f'{name}: unexpected grading provider')
        score = result.get('score')
        if type(score) is not int or not 0 <= score <= 10:
            raise SystemExit(f'{name}: invalid score')
        if (result.get('decision') == 'accepted') != (score >= 7):
            raise SystemExit(f'{name}: inconsistent decision')
        print(json.dumps({'case': name, 'question': question_id, 'provider': body.get('provider', 'legacy'), 'result': result}, ensure_ascii=False), flush=True)
        if decision and result.get('decision') != decision:
            raise SystemExit(f'{name}: unexpected decision {result.get("decision")} / {score}')
        if result.get('decision') == 'follow_up' and (context or not body.get('context') or not result.get('followUp')):
            raise SystemExit(f'{name}: invalid follow-up')
        for field in ['strengths', 'errors', 'additions']:
            if not isinstance(result.get(field), list) or any(not isinstance(item, str) for item in result[field]):
                raise SystemExit(f'{name}: invalid feedback')
        return body

    if args.case == 'all':
        check('correct-paraphrase', 'N01-001',
          'Сначала x связано с целым 7, затем со строкой "7". Типы объектов int и str. '
          'Присваивание переключает имя на другой объект, а не меняет тип старого.', 'accepted')
        wrong = check('incorrect', 'N01-001',
                  'Тип всегда остаётся int: Python автоматически превращает строку "7" обратно в число.', 'needs_work')
        if wrong['result']['score'] > 3 or not wrong['result']['errors']:
            raise SystemExit('Incorrect factual answer should identify an error and score 0–3.')
    if args.case in ['all', 'incomplete']:
        partial = check('incomplete', 'N08-002',
                    'shuffle переставляет карты в самой колоде по индексам. Читать можно, '
                    'а записывать нельзя. Какой специальный метод добавить, не помню.', '')
        if partial['result']['score'] >= 7:
            raise SystemExit('Missing the requested method should not pass.')
        if partial.get('context'):
            check('clarification', 'N08-002',
              'Нужен __setitem__(self, index, value), который делает self._cards[index] = value. '
              'shuffle меняет колоду на месте и использует запись по индексам при обмене карт.',
              'accepted', partial['context'])
    if args.case in ['all', 'code']:
        bank = json.loads((ROOT / 'questions.json').read_text(encoding='utf-8'))['questions']
        code = next(q for q in bank if q['origin'] == 'new' and q.get('code') and not q.get('duplicate_of')
                and q.get('review', {}).get('status') != 'excluded')
        check('code-reference', code['id'], (code.get('correction') or code['answer']) + '\n' + code.get('explanation', ''), 'accepted')
    print('Live voice smoke checks passed. This is a small sample, not a full grading-quality review.')


if __name__ == '__main__':
    main()
