import {freshState, validateImport} from './study.mjs';
const STORAGE_KEY = 'python-colloquium-v2';
const DB_NAME = 'python-colloquium';
export async function openStorage(questions, environment = globalThis) {
  let db = null, revision = 0, mode = 'memory', warning = '', queue = Promise.resolve();
  try {
    if (!environment.indexedDB) throw Error('IndexedDB недоступна');
    db = await new Promise((resolve, reject) => {
      const request = environment.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('Закройте другую вкладку приложения для обновления хранилища'));
    });
    db.onversionchange = () => db.close(); mode = 'indexeddb';
  } catch { warning = 'IndexedDB недоступна. Используется резервное локальное хранилище; регулярно экспортируйте прогресс.'; }
  let localCorruption;
  function readLocal() {
    let raw;
    try { raw = environment.localStorage.getItem(STORAGE_KEY); } catch { return null; }
    try { return JSON.parse(raw || 'null'); } catch { localCorruption = raw; return null; }
  }
  async function readDb() { if (!db) return null; return new Promise((resolve, reject) => { const r = db.transaction('state').objectStore('state').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  let saved;
  try { saved = await readDb(); } catch { db?.close(); db = null; mode = 'memory'; warning = 'Не удалось прочитать IndexedDB. Сохранность будет проверена при следующей записи.'; }
  const local = readLocal(); if (!saved || (local?.updatedAt || 0) > (saved.updatedAt || 0)) saved = local;
  let state = freshState();
  if (!saved && localCorruption) {
    warning = 'Резервное хранилище содержит повреждённый JSON. Исходные данные сохранены; скачайте их для восстановления.';
    return {state, mode: 'readonly', warning, rawBackup: localCorruption, save: async () => {throw Error(warning);}};
  }
  if (saved) {
    try { state = validateImport(saved, questions); state.revision = saved.revision || 0; state.updatedAt = saved.updatedAt || 0; }
    catch { warning = 'Сохранённые данные повреждены или имеют неизвестную версию. Экспортируйте файл для проверки; исходное хранилище не перезаписывается.'; return {state, mode: 'readonly', warning, save: async () => {throw Error(warning);}, rawBackup: saved}; }
  } else {
    try {
      const old = JSON.parse(environment.localStorage.getItem('python-colloquium-v1') || '{}');
      for (const q of questions) if (old[q.id]) state.progress[q.id] = {studied: old[q.id].studied === true, difficult: old[q.id].difficult === true};
    } catch { /* Older flags are optional. Never invent correct answers from them. */ }
  }
  revision = (await readDb().catch(() => null))?.revision || 0;
  async function write(snapshot) {
    snapshot.revision = revision + 1;
    if (db) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state'), read = store.get('current');
        let conflict = false;
        read.onsuccess = () => { if ((read.result?.revision || 0) !== revision) { conflict = true; tx.abort(); } else store.put(snapshot, 'current'); };
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || Error('Ошибка записи'));
        tx.onabort = () => reject(Error(conflict ? 'Прогресс изменён в другой вкладке. Экспортируйте текущую работу и перезагрузите страницу.' : 'Не удалось сохранить прогресс'));
      });
      revision++; mode = 'indexeddb';
    } else {
      try { environment.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); revision++; mode = 'localstorage'; }
      catch { mode = 'memory'; throw Error('Хранилище недоступно или заполнено. Прогресс только в памяти: экспортируйте его перед закрытием.'); }
    }
  }
  return {state, get mode() {return mode;}, warning,
    save(value) { const snapshot = structuredClone(value); const operation = queue.catch(() => {}).then(() => write(snapshot)); queue = operation; return operation; },
    close() {db?.close();}};
}
