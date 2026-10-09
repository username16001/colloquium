// Shared validation, dictation and API transport. No provider key lives in the browser.
export const MAX_AUDIO_BYTES=6*1024*1024;
export function preferAudioRecording(environment=globalThis) {
  const nav=environment.navigator||{};
  const ios=/iPad|iPhone|iPod/.test(nav.userAgent||'')||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1);
  return ios&&(nav.standalone===true||environment.matchMedia?.('(display-mode: standalone)').matches===true);
}
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
  let response;
  try {
    response = await fetcher(url.href, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal,credentials:'omit',cache:'no-store'});
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw Error('Не удалось связаться с сервером проверки. Ответ сохранён — проверьте интернет и попробуйте снова.');
  }
  let body;
  try {body = await response.json();} catch {throw Error('Сервер вернул непонятный ответ. Попробуйте позже.');}
  if (!response.ok) throw Error(typeof body.error === 'string' ? body.error : 'Проверка недоступна. Попробуйте позже.');
  const result = validateFeedback(body.result,!!payload.context);
  if (typeof body.context !== 'string' || body.context.length > 30000 || result.decision === 'follow_up' && !body.context) throw Error('Некорректный результат проверки');
  return {result,context:body.context};
}
export function createDictation({environment = globalThis,onText,onStatus,onError}) {
  const Constructor = environment.SpeechRecognition || environment.webkitSpeechRecognition;
  let recognition = null, generation = 0, timer = null, started=false;
  const clear = () => {if (timer) clearTimeout(timer);timer=null;};
  return {
    supported:!!Constructor,
    get starting(){return !!recognition&&!started;},
    start(prefix = '') {
      if (!Constructor) throw Error('Браузер не поддерживает запись речи. Можно напечатать ответ.');
      if (recognition) return;
      const current = ++generation, r = new Constructor(); recognition=r;started=false;
      let received=false,failed=false,stopped=false;
      r.lang='ru-RU';r.continuous=true;r.interimResults=true;r.maxAlternatives=1;
      r.onstart=()=>{if(current===generation){started=true;onStatus(true);}};
      r.onresult = event => {
        if (current !== generation) return;
        const fragments = Array.from(event.results, result => result[0]?.transcript || '').join(' ');
        if(fragments.trim())received=true;
        onText((prefix.trim() ? prefix.trim()+' ' : '')+fragments);
      };
      r.onerror = event => {
        if (current !== generation) return;
        failed=true;
        if (event.error === 'aborted'&&stopped) return;
        const messages={'not-allowed':'Доступ к микрофону запрещён. Разрешите его в браузере или напечатайте ответ.','service-not-allowed':'Распознавание речи недоступно. Можно напечатать ответ.','audio-capture':'Микрофон не найден. Проверьте подключение.','no-speech':'Речь не распознана. Попробуйте ещё раз.','network':'Нет связи со службой распознавания. Можно напечатать ответ.','language-not-supported':'Распознавание русского языка недоступно. Можно напечатать ответ.'};
        clear();recognition=null;started=false;generation++;
        onError(messages[event.error] || 'Не удалось распознать речь. Можно напечатать ответ.');
        onStatus(false);try{r.abort();}catch{}
      };
      r.onend = () => {if (current !== generation) return;clear();recognition=null;started=false;if(!received&&!failed&&!stopped)onError('Браузер завершил распознавание без текста. Попробуйте «Записать аудио».');onStatus(false);};
      r.requestStop=()=>{stopped=true;r.stop();};
      try {r.start();if(recognition===r&&current===generation){onStatus(true);timer=setTimeout(()=>r.requestStop(),90000);}}
      catch {recognition=null;clear();throw Error('Не удалось включить микрофон. Попробуйте ещё раз.');}
    },
    stop() {recognition?.requestStop();},
    cancel() {generation++;clear();const r=recognition;recognition=null;r?.abort();},
  };
}

export async function transcribeAudio(endpoint, questionId, audio, {fetcher=globalThis.fetch,signal}={}) {
  if(!endpoint)throw Error('Сервер распознавания ещё не подключён. Можно напечатать ответ.');
  if(!audio?.size)throw Error('Запись пустая. Запишите ответ ещё раз.');
  if(audio.size>MAX_AUDIO_BYTES)throw Error('Запись слишком большая. Запишите ответ короче.');
  const url=new URL(endpoint);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('Нужен защищённый адрес сервера распознавания.');
  url.pathname=url.pathname.replace(/\/evaluate\/?$/,'/transcribe');url.search='';url.hash='';
  const type=audio.type.split(';')[0],extension=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':type.includes('wav')?'wav':'webm';
  const form=new FormData();form.append('questionId',questionId);form.append('file',audio,'answer.'+extension);
  let response;
  try {response=await fetcher(url.href,{method:'POST',body:form,signal,credentials:'omit',cache:'no-store'});}
  catch(error){if(error.name==='AbortError')throw error;throw Error('Нет связи с сервером распознавания. Нажмите «Повторить расшифровку».');}
  let body;try{body=await response.json();}catch{throw Error('Сервер не смог расшифровать запись. Попробуйте ещё раз.');}
  if(!response.ok)throw Error(typeof body.error==='string'?body.error:'Не удалось расшифровать запись. Попробуйте ещё раз.');
  if(typeof body.text!=='string'||!body.text.trim()||body.text.length>6000)throw Error('Речь не распознана. Запишите ответ ещё раз.');
  return body.text.trim();
}

export function createAudioRecording({environment=globalThis,transcribe,onText,onStatus,onError}) {
  const media=environment.navigator?.mediaDevices,Constructor=environment.MediaRecorder;
  let job=null,generation=0,phase='idle',pendingAudio=null;
  const status=value=>{phase=value;onStatus(value);};
  const tracks=stream=>stream?.getTracks().forEach(track=>track.stop());
  const cleanup=row=>{clearTimeout(row?.timer);clearTimeout(row?.stopTimer);tracks(row?.stream);};
  async function convert(row) {
    if(job!==row)return;
    status('transcribing');row.controller=new AbortController();
    row.timer=setTimeout(()=>row.controller.abort(),45000);
    try {
      const text=await transcribe(pendingAudio,{signal:row.controller.signal});
      if(job!==row)return;
      pendingAudio=null;onText((row.prefix.trim()?row.prefix.trim()+' ':'')+text);
    } catch(error) {
      if(job===row)onError(error.name==='AbortError'?'Расшифровка заняла слишком долго. Нажмите «Повторить расшифровку».':error.message);
    } finally {cleanup(row);if(job===row){job=null;status('idle');}}
  }
  const api={
    supported:!!Constructor&&typeof media?.getUserMedia==='function',
    get phase(){return phase;},
    get canRetry(){return !!pendingAudio&&!job;},
    async start(prefix='') {
      if(job)return;
      if(!api.supported)throw Error('Запись микрофона в этом браузере недоступна. Можно напечатать ответ.');
      const row={id:++generation,prefix,stream:null,recorder:null,timer:null,stopTimer:null};job=row;pendingAudio=null;status('permission');
      try {
        row.stream=await media.getUserMedia({audio:true});
        if(job!==row){tracks(row.stream);return;}
        if(environment.document?.visibilityState==='hidden')throw Error('Вернитесь в приложение и нажмите «Ответить голосом» ещё раз.');
        const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(type=>Constructor.isTypeSupported?.(type));
        const recorder=new Constructor(row.stream,mime?{mimeType:mime}:{});row.recorder=recorder;
        const chunks=[];let bytes=0;
        recorder.ondataavailable=event=>{if(job!==row||!event.data?.size)return;bytes+=event.data.size;if(bytes>MAX_AUDIO_BYTES){api.cancel();onError('Запись слишком большая. Запишите ответ короче.');return;}chunks.push(event.data);};
        recorder.onerror=()=>{if(job!==row)return;api.cancel();onError('Не удалось записать звук. Проверьте микрофон и попробуйте снова.');};
        recorder.onstop=()=>{
          cleanup(row);if(job!==row)return;
          const type=recorder.mimeType||chunks[0]?.type||mime||'audio/webm';
          pendingAudio=new Blob(chunks,{type});
          if(!pendingAudio.size){job=null;pendingAudio=null;onError('Запись пустая. Запишите ответ ещё раз.');status('idle');return;}
          convert(row);
        };
        recorder.start(1000);status('recording');row.timer=setTimeout(()=>api.stop(),90000);
      } catch(error) {
        cleanup(row);if(job!==row)return;job=null;
        const messages={NotAllowedError:'Доступ к микрофону запрещён. Разрешите его для сайта и попробуйте снова.',NotFoundError:'Микрофон не найден. Проверьте подключение.',NotReadableError:'Микрофон занят или недоступен. Закройте другое приложение, использующее микрофон.'};
        onError(messages[error.name]||error.message||'Не удалось включить микрофон. Попробуйте ещё раз.');status('idle');
      }
    },
    stop() {
      const row=job;if(!row||phase!=='recording')return;
      clearTimeout(row.timer);status('stopping');
      try {row.recorder.stop();tracks(row.stream);if(job===row)row.stopTimer=setTimeout(()=>{if(job===row&&phase==='stopping'){api.cancel();onError('Браузер не завершил запись. Запишите ответ ещё раз.');}},5000);}
      catch {api.cancel();onError('Не удалось завершить запись. Попробуйте ещё раз.');}
    },
    retry(prefix='') {
      if(!api.canRetry)return;
      const row={id:++generation,prefix,timer:null,stopTimer:null};job=row;return convert(row);
    },
    cancel() {
      const row=job;job=null;generation++;pendingAudio=null;
      if(row){row.controller?.abort();cleanup(row);try{if(row.recorder?.state!=='inactive')row.recorder?.stop();}catch{}}
      if(phase!=='idle')status('idle');
    },
  };
  return api;
}
