import {gradingPayload} from './grading.mjs';
import {validateFeedback} from '../web/voice.mjs';

export const CLAUDE_MODEL='claude-haiku-5-5';
export const CLAUDE_RATE_ERROR='Лимит Claude исчерпан. Подождите и попробуйте снова.';
export const CLAUDE_ERRORS={
  400:'Claude отклонил запрос проверки. Владелец сайта должен проверить настройки API и баланс Anthropic.',
  401:'Ключ Anthropic не принят. Владелец сайта должен обновить ключ сервера.',
  403:'Anthropic отклонил доступ сервера. Проверка временно недоступна.',
  404:'Модель Claude недоступна. Владелец сайта должен проверить настройки Anthropic.',
  413:'Claude отклонил слишком большой запрос. Попробуйте ответить короче.',
  529:'Claude сейчас перегружен. Попробуйте позже.',
  refusal:'Claude не смог проверить этот ответ. Оценка не выставлена.',
};

export function claudePayload(question,answer,continuation=null,model=CLAUDE_MODEL) {
  const shared=gradingPayload(question,answer,continuation);
  // Haiku 5.5 rejects the old sampling parameters. Adaptive thinking can
  // precede the text block, so reserve output tokens and select by block type.
  return {model,max_tokens:4096,system:shared.messages[0].content,
    messages:shared.messages.slice(1),
    output_config:{effort:'low',format:{type:'json_schema',schema:shared.response_format.json_schema.schema}}};
}

export async function gradeWithClaude(question,answer,continuation,env,fetcher=fetch) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);
  try {
    const response=await fetcher('https://api.anthropic.com/v1/messages',{
      method:'POST',headers:{'x-api-key':env.ANTHROPIC_API_KEY.trim(),'anthropic-version':'2023-06-01','Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify(claudePayload(question,answer,continuation,env.CLAUDE_MODEL||CLAUDE_MODEL)),signal:controller.signal});
    if(response.status===429) {
      const error=Error(CLAUDE_RATE_ERROR);error.status=429;
      const retry=Number(response.headers.get('Retry-After'));
      error.retryAfter=Number.isFinite(retry)&&retry>0?Math.min(3600,Math.ceil(retry)):60;throw error;
    }
    if(CLAUDE_ERRORS[response.status])throw Error(CLAUDE_ERRORS[response.status]);
    if(!response.ok)throw Error('Нейросеть временно недоступна. Попробуйте позже.');
    const data=await response.json();
    if(data.stop_reason==='refusal')throw Error(CLAUDE_ERRORS.refusal);
    if(data.stop_reason!=='end_turn'||!Array.isArray(data.content))throw Error('Проверка не завершена. Попробуйте снова.');
    const text=data.content.filter(block=>block.type==='text').map(block=>block.text).join('');
    if(!text||text.length>24000)throw Error('Нейросеть вернула неполный разбор. Попробуйте снова.');
    const parsed=JSON.parse(text),follow=typeof parsed.followUp==='string'&&!!parsed.followUp.trim();
    return validateFeedback({...parsed,decision:follow?'follow_up':parsed.score>=7?'accepted':'needs_work'},!!continuation);
  } catch(error) {
    if(error.name==='AbortError')throw Error('Проверка заняла слишком долго. Попробуйте снова.');
    if(error instanceof SyntaxError)throw Error('Нейросеть вернула неполный разбор. Попробуйте снова.');
    throw error;
  } finally{clearTimeout(timer);}
}
