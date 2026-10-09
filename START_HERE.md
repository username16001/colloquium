# Начать подготовку

Основной интерфейс — PWA «Коллоквиум · Python». Руководство пользователя: [README.md](README.md). Полный сборник: [docs/QUESTIONS.md](docs/QUESTIONS.md). Итоги модернизации и ограничения: [MODERNIZATION_REPORT.md](MODERNIZATION_REPORT.md).

## Windows

```powershell
Set-Location X:\colloquium
py build_pwa.py
py -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Откройте http://127.0.0.1:8765/. После первого кэширования приложение работает офлайн. Ctrl+C останавливает сервер. На Mac/Linux используйте python3. Python 3.11+ достаточен; для приложения и сборки сторонние пакеты не нужны.

Если py отсутствует, используйте свой полный путь к Python. В данной среде Codex:

```powershell
$colloquiumPython = 'C:\Users\denis\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $colloquiumPython build_pwa.py
& $colloquiumPython -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Можно сразу открыть oral_questions.html: внутри есть база, интерфейс, формулы и шрифты. Для установки PWA нужен HTTPS или localhost; file: не даёт установку, а возможности сохранения зависят от браузера.

## Прежний генератор

```powershell
py generator.py --mode oral --count 9
py generator.py
py -m unittest discover -s . -p test_generator.py -v
```

Рабочая база — questions.json. README — читаемый экспорт и документация. generator.py остаётся точкой входа; question_data.py загружает данные и форматирует код; oral_mode.py и oral_template.html собирают автономную страницу. Классический билет сохраняет 2+2+2+3 и оценки, ответы открываются после завершения. Таймера в активных режимах нет.

Исходные вопросы отмечены «Прошлый коллоквиум», новые — «По лекциям». Для подготовки только по исходным используйте соответствующую кнопку на главной. Все вопросы лекций доступны в разделе «Прогресс».

В стандартном режиме ответьте устно, затем сверьтесь с эталоном и оцените себя. В голосовом режиме запись расшифровывается через Groq, а редактируемый текст проверяет GPT-6 Luna через RouterAI. Для него нужен интернет и настроенный сервер; инструкция — [docs/VOICE_SETUP.md](docs/VOICE_SETUP.md). Прогресс сохраняется локально; экспорт JSON в настройках помогает перенести его на другой компьютер.

## Проверки и редактирование

```powershell
py validate_questions.py --strict-sources
py scripts/sync_readme.py
py build_pwa.py
py -m unittest discover -s . -p 'test_*.py' -v
npm ci --ignore-scripts
npm test
```

Все 14 ноутбуков из Data.zip находятся в lectures/. Они не изменялись; нумерация source.cells начинается с нуля. Без этой папки используйте валидацию без --strict-sources; она сообщит об отсутствии материалов.

Для выполнения новых примеров установите requirements-verification.txt и запустите verify_bank.py --execute --output verification_current.json. Windows-исполнитель использует Job Object; Unix — resource. Он запускает только просмотренные новые примеры. Исторические отчёты Mac сохранены отдельно, текущий отчёт Windows — verification_current.json.

Рабочее приложение опубликовано на [GitHub Pages](https://username16001.github.io/colloquium/). Инструкции установки и работы без интернета — в README.
