import re
import random
from datetime import datetime
from pathlib import Path
import argparse
import html
from question_data import load_bank, filter_bank, to_topics, question_key, markdown, format_code, TYPE_ALIASES


def parse_readme(filename):
    """Парсит README.md и возвращает структурированные данные"""
    with open(filename, "r", encoding="utf-8") as f:
        content = f.read()

    # Разделяем на основные темы
    topic_pattern = r"^## (.+?)\n(.*?)(?=^## |\Z)"
    topics = {}

    for match in re.finditer(topic_pattern, content, re.MULTILINE | re.DOTALL):
        topic_name = match.group(1).strip()
        topic_content = match.group(2)

        # Извлекаем вопросы по уровням сложности
        questions = {"Простые": [], "Средние": [], "Сложные": []}

        # Ищем подразделы с уровнями сложности
        simple_match = re.search(
            r"### Простые вопросы\s*(.*?)(?=###|\n---|\Z)", topic_content, re.DOTALL
        )
        medium_match = re.search(
            r"### Средние вопросы\s*(.*?)(?=###|\n---|\Z)", topic_content, re.DOTALL
        )
        hard_match = re.search(
            r"### Сложные вопросы\s*(.*?)(?=###|\n---|\Z)", topic_content, re.DOTALL
        )

        # Парсим вопросы для каждого уровня
        if simple_match:
            questions["Простые"] = extract_questions_with_code(simple_match.group(1))
        if medium_match:
            questions["Средние"] = extract_questions_with_code(medium_match.group(1))
        if hard_match:
            questions["Сложные"] = extract_questions_with_code(hard_match.group(1))

        topics[topic_name] = questions

    return topics


def extract_questions_with_code(content):
    """Извлекает вопросы вместе с кодом Python, который следует за ними"""
    questions = []

    # Находим все блоки <details>
    details_matches = list(re.finditer(r"<details>.*?</details>", content, re.DOTALL))

    for i, match in enumerate(details_matches):
        question_block = match.group(0)

        # Проверяем, есть ли код Python после этого вопроса
        end_pos = match.end()
        next_details_start = (
            content.find("<details>", end_pos)
            if i < len(details_matches) - 1
            else len(content)
        )

        # Ищем код между текущим вопросом и следующим
        code_match = re.search(
            r"```python\s*(.*?)\s*```", content[end_pos:next_details_start], re.DOTALL
        )

        if code_match:
            # Добавляем код к вопросу
            code = code_match.group(1).strip()
            question_block += f"\n\n```python\n{code}\n```"

        questions.append(question_block)

    return questions


def select_random_questions(
    topics, simple_count=2, medium_count=2, hard_count=2, extra_count=3
):
    """Выбирает случайные вопросы из всех тем"""
    selected = {"Простые": [], "Средние": [], "Сложные": [], "Дополнительные": []}

    # Собираем все вопросы каждого уровня из всех тем
    all_simple = []
    all_medium = []
    all_hard = []

    for topic_name, levels in topics.items():
        for question in levels["Простые"]:
            all_simple.append((topic_name, question))
        for question in levels["Средние"]:
            all_medium.append((topic_name, question))
        for question in levels["Сложные"]:
            all_hard.append((topic_name, question))

    # The source contains one duplicate across levels. Assign each identity once.
    seen = set()
    for pool in (all_simple, all_medium, all_hard):
        unique = []
        for item in pool:
            key = question_key(item[1])
            if key not in seen:
                seen.add(key)
                unique.append(item)
        pool[:] = unique
    for level, pool, count in (("Простые", all_simple, simple_count),
                               ("Средние", all_medium, medium_count),
                               ("Сложные", all_hard, hard_count)):
        if pool and count > 0:
            selected[level] = random.sample(pool, min(count, len(pool)))

    # Для дополнительных вопросов исключаем уже выбранные
    all_questions = all_simple + all_medium + all_hard
    selected_questions = selected["Простые"] + selected["Средние"] + selected["Сложные"]

    # Оставляем только вопросы, которые не были выбраны в основные
    remaining_questions = [q for q in all_questions if q not in selected_questions]

    # Выбираем дополнительные вопросы
    if remaining_questions and extra_count > 0:
        selected["Дополнительные"] = random.sample(
            remaining_questions, min(extra_count, len(remaining_questions))
        )

    return selected


def convert_markdown_to_html(text):
    """Offline formatting which preserves and escapes every code line."""
    return markdown(text)


def format_code_with_line_numbers(code):
    return format_code(code)


def generate_html(selected_questions, output_filename):
    """Создает HTML-файл с вопросами, таблицей и таймером"""

    html_content = f"""
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Вопросы для экзамена</title>
        
        <style>
            body {{
                font-family: Arial, sans-serif;
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
                line-height: 1.6;
            }}
            button {{
                background: #4CAF50;
                color: white;
                border: none;
                padding: 15px 25px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 18px;
                margin: 10px 5px;
                transition: background 0.3s;
            }}
            button:hover {{
                background: #45a049;
                transform: translateY(-2px);
                box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            }}
            .question-container {{
                margin: 20px 0;
                padding: 20px;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                background: #fafafa;
            }}
            details {{
                margin: 15px 0;
                border: 1px solid #ddd;
                border-radius: 6px;
                padding: 15px;
                background: white;
            }}
            summary {{
                cursor: pointer;
                font-weight: bold;
                font-size: 18px;
                padding: 10px;
                background: #f5f5f5;
                border-radius: 4px;
                margin: -15px;
                padding: 15px;
            }}
            .answer {{
                margin-top: 15px;
                padding: 15px;
                background: #f9f9f9;
                border-radius: 6px;
                border-left: 4px solid #4CAF50;
            }}
            .code-block {{
                background: #2d2d2d;
                border-radius: 6px;
                overflow: hidden;
                margin: 15px 0;
                box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            }}
            .code-lines {{
                font-family: 'Courier New', monospace;
                color: #f8f8f2;
                padding: 15px 0;
                overflow-x: auto;
            }}
            .code-line {{
                display: flex;
                padding: 2px 15px;
            }}
            .line-number {{
                color: #6c6c6c;
                min-width: 40px;
                text-align: right;
                padding-right: 15px;
                user-select: none;
                border-right: 1px solid #444;
                margin-right: 15px;
            }}
            .line-content {{
                flex: 1;
                white-space: pre;
            }}
            .topic {{
                font-style: italic;
                color: #666;
                margin-bottom: 10px;
                font-size: 16px;
                padding: 5px 10px;
                background: #e9e9e9;
                border-radius: 4px;
                display: inline-block;
            }}
            .section {{
                margin-bottom: 40px;
                padding: 20px;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }}
            .controls {{
                margin: 30px 0;
                text-align: center;
                padding: 20px;
                background: #f8f8f8;
                border-radius: 8px;
            }}
            .score-section {{
                margin: 20px 0;
                padding: 15px;
                background: #e8f4fd;
                border-radius: 8px;
                border-left: 4px solid #2196F3;
            }}
            .score-input {{
                margin: 10px 0;
                display: flex;
                align-items: center;
            }}
            .score-input label {{
                margin-right: 10px;
                font-weight: bold;
                min-width: 150px;
            }}
            .score-input input {{
                padding: 8px;
                border: 1px solid #ddd;
                border-radius: 4px;
                width: 80px;
            }}
            .total-score {{
                font-size: 24px;
                font-weight: bold;
                text-align: center;
                margin: 20px 0;
                padding: 15px;
                background: #e8f5e9;
                border-radius: 8px;
                border: 2px solid #4CAF50;
            }}
            .formula-info {{
                text-align: center;
                margin: 10px 0;
                color: #666;
                font-style: italic;
            }}
            h1 {{
                color: #2c3e50;
                text-align: center;
                margin-bottom: 30px;
                border-bottom: 2px solid #eee;
                padding-bottom: 15px;
            }}
            h2 {{
                color: #34495e;
                border-left: 4px solid #3498db;
                padding-left: 15px;
            }}
            body:not(.exam-finished) .score-section {{display: none;}}
            body:not(.exam-finished) summary {{cursor: default;}}
        </style>
    </head>
    <body>
        <h1>Вопросы для экзамена</h1>
        <p style="text-align: center; color: #666;">Дата: {datetime.now().strftime("%d.%m.%Y %H:%M")}</p>
        
        <div class="controls"><button id="finish-exam" onclick="finishExam()">Завершить билет и открыть ответы</button></div>
    """

    # Основные вопросы
    html_content += '<div class="section"><h2>Основные вопросы</h2>'

    question_num = 1
    weights = {"Простые": 0.5, "Средние": 1, "Сложные": 2}

    for level in ["Простые", "Средние", "Сложные"]:
        for topic_name, question in selected_questions[level]:
            html_question = convert_markdown_to_html(question)
            weight = weights[level]
            html_content += f"""
            <div class="question-container">
                <div class="topic">Вопрос {question_num} | Тема: {html.escape(topic_name)} | Уровень: {level} | Вес: {weight}</div>
                {html_question}
                <div class="score-section">
                    <div class="score-input">
                        <label>Оценка (0-10):</label>
                        <input type="number" min="0" max="10" step="0.1" id="score_{question_num}" data-weight="{weight}" onchange="calculateTotal()">
                    </div>
                </div>
            </div>
            """
            question_num += 1

    html_content += "</div>"

    # Дополнительные вопросы
    if selected_questions["Дополнительные"]:
        html_content += '<div class="section"><h2>Дополнительные вопросы</h2>'

        for i, (topic_name, question) in enumerate(
            selected_questions["Дополнительные"], 1
        ):
            html_question = convert_markdown_to_html(question)
            weight = 1  # Вес дополнительных вопросов
            html_content += f"""
            <div class="question-container">
                <div class="topic">Дополнительный вопрос {i} | Тема: {html.escape(topic_name)} | Вес: {weight}</div>
                {html_question}
                <div class="score-section">
                    <div class="score-input">
                        <label>Оценка (0-10):</label>
                        <input type="number" min="0" max="10" step="0.1" id="score_extra_{i}" data-weight="{weight}" onchange="calculateTotal()">
                    </div>
                </div>
            </div>
            """

    html_content += "</div>"

    # Секция с итоговой оценкой
    html_content += """
        <div class="formula-info">
            Формула расчета: (Простые × 0.5) + (Средние × 1) + (Сложные × 2) + (Дополнительные × 1)
        </div>
        <div class="total-score">
            Итоговая оценка: <span id="total-score">0</span> / 10
        </div>
    """

    # Закрываем body и добавляем JavaScript
    html_content += """
        <script>
            function finishExam() {
                document.body.classList.add("exam-finished");
                document.getElementById("finish-exam").disabled = true;
            }
            function calculateTotal() {
                let total = 0;
                let maxPossible = 0;
                
                // Основные вопросы
                const basicQuestions = document.querySelectorAll('input[id^="score_"]:not([id^="score_extra_"])');
                basicQuestions.forEach(input => {
                    const score = parseFloat(input.value) || 0;
                    const weight = parseFloat(input.dataset.weight);
                    total += score * weight / 10; // Делим на 10, так как оценка вводится по 10-балльной шкале
                    maxPossible += 10 * weight / 10; // Максимальная оценка для этого вопроса
                });
                
                // Дополнительные вопросы
                const extraQuestions = document.querySelectorAll('input[id^="score_extra_"]');
                extraQuestions.forEach(input => {
                    const score = parseFloat(input.value) || 0;
                    const weight = parseFloat(input.dataset.weight);
                    total += score * weight / 10; // Делим на 10, так как оценка вводится по 10-балльной шкале
                    maxPossible += 10 * weight / 10; // Максимальная оценка для этого вопроса
                });
                
                // Ограничиваем максимальную оценку 10
                total = Math.min(total, 10);
                
                document.getElementById('total-score').textContent = total.toFixed(2);
            }

            document.querySelectorAll("summary").forEach(summary => {
                summary.addEventListener("click", event => {
                    if (!document.body.classList.contains("exam-finished")) event.preventDefault();
                });
            });
            // Автоматически закрывать все ответы при загрузке
            document.querySelectorAll('details').forEach(detail => {
                detail.open = false;
            });
        </script>
    </body>
    </html>
    """

    with open(output_filename, "w", encoding="utf-8") as f:
        f.write(html_content)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Генератор билетов и устная подготовка по 14 лекциям")
    parser.add_argument('--mode', choices=['classic', 'oral'], default='classic')
    parser.add_argument('--count', type=int, default=9, help='Вопросов в устном варианте')
    parser.add_argument('--lectures', help='Номера через запятую, например 3,4,9')
    parser.add_argument('--types', help='theory,code,deep,algorithm,tricky через запятую')
    parser.add_argument('--difficulty', help='Простые,Средние,Сложные через запятую')
    parser.add_argument('--seed', type=int)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--bank', type=Path)
    parser.add_argument('--stats', action='store_true')
    args = parser.parse_args(argv)
    try:
        lectures = {int(x) for x in args.lectures.split(',')} if args.lectures else None
        if lectures and not lectures.issubset(range(1, 15)):
            raise ValueError('Лекции должны быть от 1 до 14')
        types = [x.strip() for x in args.types.split(',')] if args.types else None
        if types and any(x not in TYPE_ALIASES and x not in TYPE_ALIASES.values() for x in types):
            raise ValueError('Неизвестный тип вопроса')
        levels = [x.strip() for x in args.difficulty.split(',')] if args.difficulty else None
        if levels and any(x not in ['Простые','Средние','Сложные'] for x in levels):
            raise ValueError('Неизвестная сложность')
        bank = load_bank(args.bank)
        questions = filter_bank(bank, lectures, types, levels)
        if not questions:
            raise ValueError('По фильтрам нет вопросов')
        if args.count <= 0:
            raise ValueError('Количество должно быть положительным')
        if args.stats:
            from collections import Counter
            print('Всего записей:', len(questions))
            print('По лекциям:', dict(sorted(Counter(q['lecture'] for q in questions).items())))
            print('По типам:', dict(Counter(q['type'] for q in questions)))
            return 0
        if args.seed is not None:
            random.seed(args.seed)
        if args.mode == 'oral':
            from oral_mode import generate_oral
            output = args.output or Path('oral_questions.html')
            generate_oral(questions, output, args.count, args.seed)
        else:
            topics = to_topics(questions)
            selected = select_random_questions(topics, 2, 2, 2, 3)
            output = args.output or Path('exam_questions.html')
            generate_html(selected, output)
            n = sum(map(len, selected.values()))
            if n < 9:
                print(f'По фильтрам доступно только {n} вопросов для схемы 2+2+2+3.')
        print(f'База: {len(bank)} записей; по фильтрам: {len(questions)}; файл: {output.resolve()}')
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f'Ошибка: {exc}')
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
