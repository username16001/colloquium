import {gradingPayload} from './grading.mjs';
import {validateFeedback} from '../web/voice.mjs';

export const ROUTERAI_MODEL='openai/gpt-6-luna';
export const ROUTERAI_RATE_ERROR='Лимит RouterAI исчерпан. Подождите и попробуйте снова.';
export const ROUTERAI_ERRORS={
  400:'RouterAI отклонил запрос проверки. Владелец сайта должен проверить настройки сервера.',
  401:'Ключ RouterAI не принят. Владелец сайта должен обновить ключ сервера.',
  402:'На балансе RouterAI недостаточно средств. Владелец сайта должен пополнить баланс.',
  403:'RouterAI отклонил доступ к модели. Проверка временно недоступна.',
  404:'GPT-6 Luna недоступна. Владелец сайта должен проверить настройки RouterAI.',
  413:'RouterAI отклонил слишком большой запрос. Попробуйте ответить короче.',
  422:'RouterAI не смог обработать запрос проверки. Попробуйте позже.',
  refusal:'GPT-6 Luna не смогла проверить этот ответ. Оценка не выставлена.',
};

export function routerPayload(question,answer,continuation=null,model=ROUTERAI_MODEL) {
  const shared=gradingPayload(question,answer,continuation);
  // Use the ordinary text model, not the Decisions endpoint. Do not pass
  // Groq sampling settings or expose the model's private reasoning.
  return {model,messages:shared.messages,response_format:shared.response_format,
    max_completion_tokens:4096,reasoning:{effort:'low'},include_reasoning:false};
}

export async function gradeWithRouterAI(question,answer,continuation,env,fetcher=fetch) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);
  try {
    const response=await fetcher('https://routerai.ru/api/v1/chat/completions',{
      method:'POST',headers:{Authorization:'Bearer '+env.ROUTERAI_API_KEY.trim(),'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify(routerPayload(question,answer,continuation,env.ROUTERAI_MODEL||ROUTERAI_MODEL)),signal:controller.signal});
    if(response.status===429) {
      const error=Error(ROUTERAI_RATE_ERROR);error.status=429;
      const retry=Number(response.headers.get('Retry-After'));
      error.retryAfter=Number.isFinite(retry)&&retry>0?Math.min(3600,Math.ceil(retry)):60;throw error;
    }
    if(ROUTERAI_ERRORS[response.status])throw Error(ROUTERAI_ERRORS[response.status]);
    if(!response.ok)throw Error('Нейросеть временно недоступна. Попробуйте позже.');
    const data=await response.json(),choice=data.choices?.[0];
    if(choice?.message?.refusal)throw Error(ROUTERAI_ERRORS.refusal);
    if(choice?.finish_reason!=='stop')throw Error('Проверка не завершена. Попробуйте снова.');
    const text=choice.message?.content;
    if(typeof text!=='string'||!text||text.length>24000)throw Error('Нейросеть вернула неполный разбор. Попробуйте снова.');
    const parsed=JSON.parse(text),follow=typeof parsed.followUp==='string'&&!!parsed.followUp.trim();
    return validateFeedback({...parsed,decision:follow?'follow_up':parsed.score>=7?'accepted':'needs_work'},!!continuation);
  } catch(error) {
    if(error.name==='AbortError')throw Error('Проверка заняла слишком долго. Попробуйте снова.');
    if(error instanceof SyntaxError)throw Error('Нейросеть вернула неполный разбор. Попробуйте снова.');
    throw error;
  } finally{clearTimeout(timer);}
}
