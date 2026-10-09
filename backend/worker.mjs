import bank from '../questions.json' with {type:'json'};
import {gradeWithGroq,PROVIDER_ERRORS,PERMISSION_ERRORS} from './grading.mjs';
const questions=new Map(bank.questions.filter(q=>!q.duplicate_of && q.review?.status!=='excluded').map(q=>[q.id,q]));
const encoder=new TextEncoder(),decoder=new TextDecoder();
const base64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const unbase64=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
async function signingKey(secret) {return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signContext(value, secret) {
  const payload=base64(encoder.encode(JSON.stringify(value)));
  const signature=await crypto.subtle.sign('HMAC',await signingKey(secret),encoder.encode(payload));
  return payload+'.'+base64(new Uint8Array(signature));
}
export async function readContext(token, secret, questionId, now = Date.now()) {
  try {
    if (typeof token!=='string' || token.length>30000) throw Error();
    const [payload,signature,...extra]=token.split('.');
    if (extra.length || !signature || !await crypto.subtle.verify('HMAC',await signingKey(secret),unbase64(signature),encoder.encode(payload))) throw Error();
    const value=JSON.parse(decoder.decode(unbase64(payload)));
    if (value.questionId!==questionId || !Number.isFinite(value.expires) || value.expires<now || typeof value.answer!=='string' || typeof value.followUp!=='string') throw Error();
    return value;
  } catch {throw Error('Уточнение устарело. Начните новую попытку ответа.');}
}
export function createWorker({fetcher=fetch,now=Date.now} = {}) {
  return {async fetch(request,env) {
    const origin=request.headers.get('Origin'),allowed=(env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim());
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'};
    const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
    if (!origin || !allowed.includes(origin)) return reply({error:'Этот сайт не подключён к проверке.'},403);
    Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'});
    const path=new URL(request.url).pathname;
    if (path!=='/evaluate') return reply({error:'Страница не найдена.'},404);
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers});
    if (request.method!=='POST') return reply({error:'Метод не поддерживается.'},405);
    if (!env.GROQ_API_KEY || !env.VOICE_RATE_LIMIT) return reply({error:'Сервер проверки ещё не настроен.'},503);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply({error:'Ожидается JSON.'},415);
    try {
      const {success}=await env.VOICE_RATE_LIMIT.limit({key:request.headers.get('CF-Connecting-IP') || 'local'});
      if (!success) return reply({error:'Слишком много проверок. Подождите минуту.'},429);
      // Bound the body while reading; Content-Length alone is controlled by the caller.
      const reader=request.body?.getReader();if (!reader) return reply({error:'Нет ответа.'},400);
      let size=0,chunks=[];
      while (true) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>48000){await reader.cancel();return reply({error:'Ответ слишком длинный.'},413);}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      let body;try{body=JSON.parse(decoder.decode(bytes));}catch{return reply({error:'Некорректный JSON.'},400);}
      const question=questions.get(body?.questionId);
      if (!question || typeof body.answer!=='string' || !body.answer.trim() || body.answer.length>6000) return reply({error:'Выберите вопрос и ответьте на него (до 6000 символов).'},400);
      let continuation=null;
      if (body.context) {try{continuation=await readContext(body.context,env.GROQ_API_KEY,question.id,now());}catch(error){return reply({error:error.message},400);}}
      const result=await gradeWithGroq(question,body.answer.trim(),continuation,env,fetcher);
      const context=result.decision==='follow_up' ? await signContext({questionId:question.id,answer:body.answer.trim(),followUp:result.followUp,expires:now()+3600000},env.GROQ_API_KEY) : '';
      return reply({result,context});
    } catch (error) {
      // Never echo upstream bodies, credentials, or student transcripts in logs or errors.
      const safe=[...Object.values(PROVIDER_ERRORS),...Object.values(PERMISSION_ERRORS),'Лимит Groq исчерпан. Подождите и попробуйте снова.','Нейросеть временно недоступна. Попробуйте позже.','Проверка заняла слишком долго. Попробуйте снова.','Проверка не завершена. Попробуйте снова.','Нейросеть вернула неполный разбор. Попробуйте снова.'];
      return reply({error:safe.includes(error.message)?error.message:'Проверка не удалась. Ответ сохранён — попробуйте снова.'},502);
    }
  }};
}
export default createWorker();
