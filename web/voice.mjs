// Shared validation, dictation and API transport. No provider key lives in the browser.
export function validateFeedback(value, final = false) {
  if (!value || !Number.isInteger(value.score) || value.score < 0 || value.score > 10 ||
      !['accepted','needs_work','follow_up'].includes(value.decision) ||
      typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 2000 ||
      typeof value.followUp !== 'string' || value.followUp.length > 1000) throw Error('Некорректный результат проверки');
  for (const key of ['strengths','errors','additions']) {
    if (!Array.isArray(value[key]) || value[key].length > 5 || value[key].some(s => typeof s !== 'string' || !s.trim() || s.length > 1000)) throw Error('Некорректный разбор ответа');
  }
  if ((value.decision === 'accepted') !== (value.score >= 7) ||
      (value.decision === 'follow_up') !== !!value.followUp.trim() ||
      value.decision === 'follow_up' && (value.score<4 || value.score>6) ||
      final && value.decision === 'follow_up') throw Error('Несогласованная оценка');
  return Object.fromEntries(['score','decision','summary','strengths','errors','additions','followUp'].map(k => [k, structuredClone(value[k])]));
}
export function sanitizeVoiceRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Некорректный голосовой ответ');
  const text = v => {if (typeof v !== 'string' || v.length > 6000) throw Error('Ответ слишком длинный');return v;};
  if (!Array.isArray(value.turns) || value.turns.length > 2) throw Error('Некорректный диалог');
  if (value.turns.length===2 && value.turns[0]?.result?.decision!=='follow_up') throw Error('Уточнение без вопроса');
  return {draft:text(value.draft ?? ''), followDraft:text(value.followDraft ?? ''), turns:value.turns.map((turn,i) => {
    if (!turn || typeof turn.context !== 'string' || turn.context.length > 30000) throw Error('Некорректный диалог');
    return {answer:text(turn.answer),result:validateFeedback(turn.result,i === 1),context:turn.context};
  })};
}
export async function evaluateAnswer(endpoint, payload, {fetcher = globalThis.fetch, signal} = {}) {
  if (!endpoint) throw Error('Сервер проверки ещё не подключён. Пока можно записать ответ или заниматься в стандартном режиме.');
  if (!payload.answer?.trim()) throw Error('Сначала запишите или напечатайте ответ.');
  if (payload.answer.length > 6000) throw Error('Сократите ответ до 6000 символов.');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw Error('Нужен защищённый адрес сервера проверки.');
  const response = await fetcher(url.href, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal,credentials:'omit',cache:'no-store'});
  let body;
  try {body = await response.json();} catch {throw Error('Сервер вернул непонятный ответ. Попробуйте позже.');}
  if (!response.ok) throw Error(typeof body.error === 'string' ? body.error : 'Проверка недоступна. Попробуйте позже.');
  const result = validateFeedback(body.result,!!payload.context);
  if (typeof body.context !== 'string' || body.context.length > 30000 || result.decision === 'follow_up' && !body.context) throw Error('Некорректный результат проверки');
  return {result,context:body.context};
}
export function createDictation({environment = globalThis,onText,onStatus,onError}) {
  const Constructor = environment.SpeechRecognition || environment.webkitSpeechRecognition;
  let recognition = null, generation = 0, timer = null;
  const clear = () => {if (timer) clearTimeout(timer);timer=null;};
  return {
    supported:!!Constructor,
    start(prefix = '') {
      if (!Constructor) throw Error('Браузер не поддерживает запись речи. Можно напечатать ответ.');
      if (recognition) return;
      const current = ++generation, r = new Constructor(); recognition=r;
      r.lang='ru-RU';r.continuous=true;r.interimResults=true;r.maxAlternatives=1;
      r.onresult = event => {
        if (current !== generation) return;
        const fragments = Array.from(event.results, result => result[0]?.transcript || '').join(' ');
        onText((prefix.trim() ? prefix.trim()+' ' : '')+fragments);
      };
      r.onerror = event => {
        if (current !== generation || event.error === 'aborted') return;
        const messages={'not-allowed':'Доступ к микрофону запрещён. Разрешите его в браузере или напечатайте ответ.','service-not-allowed':'Распознавание речи недоступно. Можно напечатать ответ.','audio-capture':'Микрофон не найден. Проверьте подключение.','no-speech':'Речь не распознана. Попробуйте ещё раз.','network':'Нет связи со службой распознавания. Можно напечатать ответ.','language-not-supported':'Распознавание русского языка недоступно. Можно напечатать ответ.'};
        onError(messages[event.error] || 'Не удалось распознать речь. Можно напечатать ответ.');
      };
      r.onend = () => {if (current !== generation) return;clear();recognition=null;onStatus(false);};
      try {r.start();onStatus(true);timer=setTimeout(()=>r.stop(),90000);}
      catch {recognition=null;clear();throw Error('Не удалось включить микрофон. Попробуйте ещё раз.');}
    },
    stop() {recognition?.stop();},
    cancel() {generation++;clear();const r=recognition;recognition=null;r?.abort();},
  };
}
