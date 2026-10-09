import {MAX_AUDIO_BYTES} from '../web/voice.mjs';
export const TRANSCRIPTION_ERRORS=[
  'Ключ Groq не принят. Владелец сайта должен обновить ключ сервера.',
  'Groq отклонил распознавание аудио. Попробуйте позже.',
  'Groq не смог прочитать запись. Запишите ответ ещё раз.',
  'Распознавание временно недоступно. Попробуйте позже.',
  'Расшифровка заняла слишком долго. Попробуйте ещё раз.',
  'Речь не распознана. Запишите ответ ещё раз.',
];
export const AUDIO_TYPES=['audio/mp4','video/mp4','audio/webm','video/webm','audio/ogg','audio/wav','audio/x-wav','audio/mpeg','audio/flac'];
export async function transcribeWithGroq(file,env,fetcher=fetch) {
  if(file.size>MAX_AUDIO_BYTES)throw Error('Запись слишком большая.');
  const form=new FormData();
  // Construct the provider request ourselves; never forward caller-supplied options or URLs.
  const type=file.type.split(';')[0],extension=type.includes('mp4')?'m4a':type.includes('wav')?'wav':type.includes('ogg')?'ogg':type.includes('mpeg')?'mp3':type.includes('flac')?'flac':'webm';
  form.append('file',file,'answer.'+extension);form.append('model','whisper-large-v3-turbo');
  form.append('language','ru');form.append('response_format','json');form.append('temperature','0');
  form.append('prompt','Ответ на вопрос по Python. Термины: список, словарь, кортеж, генератор, итератор, декоратор, __getitem__, __setitem__.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);
  try {
    const response=await fetcher('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+env.GROQ_API_KEY.trim()},body:form,signal:controller.signal});
    if(response.status===429){const error=Error('Лимит Groq исчерпан. Подождите и попробуйте снова.');error.status=429;const retry=Number(response.headers.get('Retry-After'));error.retryAfter=Number.isFinite(retry)&&retry>0?Math.min(3600,Math.ceil(retry)):60;throw error;}
    if(response.status===401)throw Error(TRANSCRIPTION_ERRORS[0]);
    if(response.status===403)throw Error(TRANSCRIPTION_ERRORS[1]);
    if([400,413,422].includes(response.status))throw Error(TRANSCRIPTION_ERRORS[2]);
    if(!response.ok)throw Error(TRANSCRIPTION_ERRORS[3]);
    const data=await response.json();
    if(typeof data.text!=='string'||!data.text.trim()||data.text.length>6000)throw Error(TRANSCRIPTION_ERRORS[5]);
    return data.text.trim();
  } catch(error) {
    if(error.name==='AbortError')throw Error(TRANSCRIPTION_ERRORS[4]);
    if(error instanceof SyntaxError)throw Error(TRANSCRIPTION_ERRORS[3]);
    throw error;
  } finally{clearTimeout(timer);}
}
