// Pure, deterministic scheduling and statistics. An oral answer is self-assessed.
export const DAY = 86400000;
export const CONFIDENCE = ['guess', 'unsure', 'know'];
export function freshState() {
  return {schemaVersion: 1, revision: 0, updatedAt: 0, progress: {}, history: [], session: null,
    settings: {theme: 'system', count: 9, lectures: [], types: [], levels: [], origin: 'all', smartMode: 'balanced'}};
}
export function usable(questions) { return questions.filter(q => !q.duplicate_of && q.review?.status !== 'excluded'); }
export function filtered(questions, filters = {}) {
  return usable(questions).filter(q => (!filters.lectures?.length || filters.lectures.includes(q.lecture)) &&
    (!filters.types?.length || filters.types.includes(q.type)) && (!filters.levels?.length || filters.levels.includes(q.difficulty)) &&
    (!filters.origin || filters.origin === 'all' || q.origin === filters.origin));
}
export function hash(text) { let n = 2166136261; for (const c of String(text)) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; }
export function shuffle(questions, seed) {
  let n = hash(seed); const result = [...questions];
  for (let i = result.length - 1; i > 0; i--) { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; const j = n % (i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
function advanceProgress(p, correct, confidence, now) {
  const factor = Number.isFinite(p.lastSeen) && now-p.lastSeen < DAY/2 ? 1 : confidence === 'know' ? 2.5 : 1.8;
  const interval = !correct ? .25 : confidence === 'guess' ? .5 : confidence === 'unsure' ? 1 :
    Math.min(60, Math.max(confidence === 'know' ? 2 : 1, (p.intervalDays || 0) * factor));
  const qualified = correct && confidence !== 'guess';
  const spaced = !p.spacedSuccesses || now - (p.lastQualifiedAt ?? 0) >= DAY / 2;
  const spacedSuccesses = !qualified ? 0 : (p.spacedSuccesses || 0) + Number(spaced);
  return {...p, attempts: (p.attempts || 0) + 1, correct: (p.correct || 0) + Number(correct),
    errors: (p.errors || 0) + Number(!correct), streak: correct ? (p.streak || 0) + 1 : 0,
    lastCorrect: correct, lastConfidence: confidence, lastSeen: now, intervalDays: interval, dueAt: now + interval * DAY,
    spacedSuccesses, lastQualifiedAt: qualified && spaced ? now : p.lastQualifiedAt || 0,
    mastered: qualified && spacedSuccesses >= 2};
}
export function recordAnswer(state, question, correct, confidence = null, now = Date.now(), sessionId = '') {
  if (typeof correct !== 'boolean' || !Number.isFinite(now) || now < 0 || (confidence !== null && !CONFIDENCE.includes(confidence))) throw Error('Некорректная оценка');
  if (state.history.some(a => a.questionId === question.id && a.sessionId === sessionId)) return state;
  const next = structuredClone(state), p = next.progress[question.id] || {};
  next.progress[question.id] = advanceProgress(p, correct, confidence, now);
  next.history.push({questionId: question.id, sessionId, at: now, correct, confidence, lecture: question.lecture, origin: question.origin, firstAttempt: !p.attempts});
  next.updatedAt = now; return next;
}
export function stats(questions, state, now = Date.now()) {
  const qs = usable(questions), ids = new Set(qs.map(q => q.id));
  const attempts = state.history.filter(a => ids.has(a.questionId));
  function group(rows) {
    const rowIds = new Set(rows.map(q => q.id)), history = attempts.filter(a => rowIds.has(a.questionId));
    return {total: rows.length, seen: rows.filter(q => state.progress[q.id]?.attempts).length,
      mastered: rows.filter(q => state.progress[q.id]?.mastered).length,
      due: rows.filter(q => state.progress[q.id]?.attempts && state.progress[q.id].dueAt <= now).length,
      errors: rows.filter(q => state.progress[q.id]?.lastCorrect === false).length,
      attempts: history.length, correct: history.filter(a => a.correct).length,
      first: history.filter(a => a.firstAttempt).length, firstCorrect: history.filter(a => a.firstAttempt && a.correct).length};
  }
  return {...group(qs), originals: group(qs.filter(q => q.origin === 'original')),
    lectures: Array.from({length: 14}, (_, i) => ({lecture: i + 1, ...group(qs.filter(q => q.lecture === i + 1))})),
    history: attempts};
}
export function recommend(questions, state, options = {}, now = Date.now()) {
  const rows = filtered(questions, options), count = Math.max(1, Math.min(100, options.count || 9));
  const summary = stats(rows, state, now), lectures = new Map(summary.lectures.map(l => [l.lecture, l]));
  const mode = options.smartMode || 'balanced', seed = options.seed ?? 0;
  let candidates = rows;
  if (mode === 'new') candidates = rows.filter(q => !state.progress[q.id]?.attempts);
  if (mode === 'review') candidates = rows.filter(q => state.progress[q.id]?.attempts);
  if (mode === 'errors') candidates = rows.filter(q => state.progress[q.id]?.lastCorrect === false || state.progress[q.id]?.difficult);
  const ranked = candidates.map(q => {
    const p = state.progress[q.id] || {}, l = lectures.get(q.lecture), reasons = [];
    let score = !p.attempts ? 30 : 0;
    if (options.finalReview && q.origin === 'original') { score += 35; reasons.push('Исходный вопрос прошлого коллоквиума'); }
    if (p.lastCorrect === false || p.difficult) { score += 150; reasons.push('Ранее была ошибка или отметка «Сложно»'); }
    if (p.attempts && ['guess', 'unsure'].includes(p.lastConfidence)) { score += 80; reasons.push('Последний ответ был неуверенным'); }
    if (p.attempts && p.dueAt <= now) { score += 75 + Math.min(30, (now - p.dueAt) / DAY); reasons.push('Наступил срок повторения'); }
    if (l.attempts >= 3 && l.correct / l.attempts < .7) { score += mode === 'weak' ? 100 : 45; reasons.push('В этой лекции часто возникали ошибки'); }
    if (p.attempts) score += 25 * (p.errors || 0) / p.attempts;
    if (l.total && l.mastered / l.total > .5 && q.difficulty === 'Сложные' && !p.mastered) score += 20;
    if (p.lastSeen && now - p.lastSeen < DAY / 2) score -= 110;
    if (!reasons.length) reasons.push(p.attempts ? 'Поддерживаем изученный материал' : 'Новый вопрос для диагностики знаний');
    return {question: q, score, reason: reasons.join('. '), tie: hash(q.id + ':' + seed)};
  }).sort((a, b) => b.score - a.score || a.tie - b.tie);
  // Penalize already selected lectures to keep diagnostics and daily sets diverse.
  const selected = [], usage = new Map();
  while (ranked.length && selected.length < count) {
    let best = 0;
    for (let i = 1; i < ranked.length; i++) if (ranked[i].score - (usage.get(ranked[i].question.lecture) || 0) * 45 > ranked[best].score - (usage.get(ranked[best].question.lecture) || 0) * 45) best = i;
    const item = ranked.splice(best, 1)[0]; selected.push(item); usage.set(item.question.lecture, (usage.get(item.question.lecture) || 0) + 1);
  }
  return selected;
}
export function ticket(questions, seed = 0) {
  const qs = shuffle(usable(questions), seed);
  for (const a of qs.filter(q => q.type === 'Теория')) for (const b of qs.filter(q => q.type === 'Понимание кода' && q.lecture !== a.lecture)) {
    const c = qs.find(q => !['Теория', 'Понимание кода'].includes(q.type) && ![a.lecture, b.lecture].includes(q.lecture));
    if (c) return [a, b, c];
  }
  return [];
}
export function validateImport(input, questions) {
  if (!input || input.schemaVersion !== 1 || !input.progress || typeof input.progress !== 'object' || Array.isArray(input.progress) || !Array.isArray(input.history)) throw Error('Неизвестный формат прогресса');
  const questionMap = new Map(usable(questions).map(q => [q.id,q])), ids = new Set(questionMap.keys()), clean = freshState();
  for (const [id, p] of Object.entries(input.progress)) {
    if (!ids.has(id)) continue;
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw Error('Некорректная запись прогресса');
    const row = {};
    for (const k of ['attempts', 'correct', 'errors', 'streak', 'lastSeen', 'dueAt', 'intervalDays', 'spacedSuccesses', 'lastQualifiedAt']) {
      if (p[k] !== undefined && (!Number.isFinite(p[k]) || p[k] < 0 || (['attempts', 'correct', 'errors', 'streak', 'spacedSuccesses'].includes(k) && !Number.isInteger(p[k])))) throw Error('Некорректные числа прогресса');
      if (p[k] !== undefined) row[k] = p[k];
    }
    if ((row.correct || 0) + (row.errors || 0) !== (row.attempts || 0)) throw Error('Несогласованные счётчики');
    for (const k of ['favorite', 'difficult', 'studied', 'lastCorrect']) if (p[k] !== undefined) { if (typeof p[k] !== 'boolean') throw Error('Некорректная отметка'); row[k] = p[k]; }
    if (p.lastConfidence !== undefined && p.lastConfidence !== null && !CONFIDENCE.includes(p.lastConfidence)) throw Error('Некорректная уверенность');
    row.lastConfidence = p.lastConfidence ?? null; row.mastered = row.spacedSuccesses >= 2 && row.lastCorrect === true && row.lastConfidence !== 'guess';
    clean.progress[id] = row;
  }
  if (input.history.length > 100000) throw Error('Слишком большая история');
  const dedup = new Set(), reconstructed = {};
  for (const a of input.history) {
    if (!a || !ids.has(a.questionId)) continue;
    if (typeof a.correct !== 'boolean' || !Number.isFinite(a.at) || a.at < 0 || typeof a.sessionId !== 'string' || (a.confidence !== null && !CONFIDENCE.includes(a.confidence))) throw Error('Некорректная история');
    const key = a.sessionId + ':' + a.questionId;
    if (dedup.has(key)) throw Error('Повтор оценки в одной сессии'); dedup.add(key);
    const q = questionMap.get(a.questionId), p = reconstructed[a.questionId] || {};
    clean.history.push({questionId: a.questionId, sessionId: a.sessionId, at: a.at, correct: a.correct, confidence: a.confidence, lecture: q.lecture, origin: q.origin, firstAttempt: !p.attempts});
    reconstructed[a.questionId] = advanceProgress(p, a.correct, a.confidence, a.at);
  }
  for (const id of new Set([...Object.keys(clean.progress),...Object.keys(reconstructed)])) {
    const p = clean.progress[id] || {}, r = reconstructed[id] || {};
    if (['attempts','correct','errors'].some(k => (p[k] || 0) !== (r[k] || 0))) throw Error('История не соответствует счётчикам прогресса');
    // Scheduling and mastery are derived from the validated history, never trusted from a file.
    clean.progress[id] = {...r,...Object.fromEntries(['favorite','difficult','studied'].filter(k => p[k] !== undefined).map(k => [k,p[k]]))};
  }
  const s = input.settings || {};
  if (['light', 'dark', 'system'].includes(s.theme)) clean.settings.theme = s.theme;
  if (Number.isInteger(s.count) && s.count >= 1 && s.count <= 100) clean.settings.count = s.count;
  clean.settings.lectures = Array.isArray(s.lectures) ? s.lectures.filter(n => Number.isInteger(n) && n >= 1 && n <= 14) : [];
  clean.settings.types = Array.isArray(s.types) ? s.types.filter(t => questions.some(q => q.type === t)) : [];
  clean.settings.levels = Array.isArray(s.levels) ? s.levels.filter(t => ['Простые','Средние','Сложные'].includes(t)) : [];
  if (['all','original','new'].includes(s.origin)) clean.settings.origin = s.origin;
  if (['balanced','weak','review','new','errors'].includes(s.smartMode)) clean.settings.smartMode = s.smartMode;
  if (input.session) {
    const session = input.session;
    if (!Array.isArray(session.ids) || session.ids.length < 1 || session.ids.length > 100 || !session.ids.every(id => ids.has(id) && !questions.find(q => q.id === id).duplicate_of) || new Set(session.ids).size !== session.ids.length || !Number.isInteger(session.index) || session.index < 0 || session.index >= Math.max(1,session.ids.length) || !['practice','smart','exam'].includes(session.mode) || typeof session.id !== 'string') throw Error('Некорректная сессия');
    clean.session = {id: session.id, ids: [...session.ids], index: session.index, mode: session.mode,
      createdAt: Number.isFinite(session.createdAt) ? session.createdAt : Date.now(), finished: session.finished === true, completed: session.completed === true,
      revealed: Object.fromEntries(session.ids.map(id => [id, session.mode === 'exam' && !session.finished ? false : session.revealed?.[id] === true])),
      responded: session.ids.filter(id => Array.isArray(session.responded) && session.responded.includes(id)), reasons: {}, ratings: {}, confidence: {}};
    for (const id of session.ids) {
      if (typeof session.reasons?.[id] === 'string') clean.session.reasons[id] = session.reasons[id].slice(0,1000);
      if (CONFIDENCE.includes(session.confidence?.[id])) clean.session.confidence[id] = session.confidence[id];
      const grade = clean.history.find(a => a.sessionId === session.id && a.questionId === id);
      if (grade && (session.mode !== 'exam' || session.finished)) clean.session.ratings[id] = {correct: grade.correct, confidence: grade.confidence};
    }
  }
  return clean;
}
