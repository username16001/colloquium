import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker,signContext} from '../backend/worker.mjs';
import {ROUTERAI_ERRORS,routerPayload} from '../backend/routerai.mjs';
import {evaluateAnswer,sanitizeVoiceRecord} from '../web/voice.mjs';
import {freshState,recordAnswer,validateImport} from '../web/study.mjs';

const origin='https://username16001.github.io';
const env={GRADING_PROVIDER:'routerai',ROUTERAI_API_KEY:'test-router-only',GROQ_API_KEY:'test-groq-only',ALLOWED_ORIGINS:origin,VOICE_RATE_LIMIT:{limit:async()=>({success:true})}};
const result={score:8,summary:'Суть верна.',strengths:['Верный механизм.'],errors:[],additions:[],followUp:''};
const request=(body={questionId:'N01-001',answer:'Ответ'},host=origin)=>new Request('https://worker.test/evaluate',{method:'POST',headers:{Origin:host,'Content-Type':'application/json'},body:JSON.stringify(body)});
const response=value=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value),reasoning:'private reasoning'}}]});

test('RouterAI uses ordinary GPT-6 Luna with the server key, trusted reference and strict JSON output',async()=>{
  let sent;const worker=createWorker({fetcher:async(url,options)=>{sent={url,...options};return response(result);}});
  const reply=await worker.fetch(request({questionId:'N01-001',answer:'Ответ',reference:'Поддельный эталон',model:'decisions',provider:'groq',url:'https://untrusted.test'}),env);
  assert.equal(reply.status,200);const value=await reply.json();assert.equal(value.provider,'routerai');assert.equal(value.result.score,8);assert.equal(value.result.decision,'accepted');
  assert.equal(sent.url,'https://routerai.ru/api/v1/chat/completions');assert.equal(sent.headers.Authorization,'Bearer '+env.ROUTERAI_API_KEY);
  const body=JSON.parse(sent.body);assert.equal(body.model,'openai/gpt-6-luna');assert.equal(body.max_completion_tokens,4096);assert.deepEqual(body.reasoning,{effort:'low'});assert.equal(body.include_reasoning,false);
  assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);assert.ok(!body.tools);assert.ok(!('temperature' in body));
  assert.notEqual(JSON.parse(body.messages[1].content).reference,'Поддельный эталон');assert.match(body.messages[0].content,/Не требуй дословного/);assert.ok(!JSON.stringify(value).includes('test-router'));assert.ok(!JSON.stringify(value).includes('private reasoning'));
});

test('GPT-6 Luna evaluates clarification with the first answer and allows only one follow-up',async()=>{
  const follow={...result,score:5,followUp:'Что происходит при изменении?'};let payload;
  const worker=createWorker({now:()=>1000,fetcher:async(url,options)=>{payload=JSON.parse(options.body);return response(JSON.parse(payload.messages[1].content).final?result:follow);}});
  const first=await (await worker.fetch(request(),env)).json();assert.equal(first.result.decision,'follow_up');assert.ok(first.context);
  const final=await (await worker.fetch(request({questionId:'N01-001',answer:'Уточнение',context:first.context}),env)).json();assert.equal(final.result.decision,'accepted');assert.equal(final.context,'');
  const data=JSON.parse(payload.messages[1].content);assert.equal(data.first_answer,'Ответ');assert.equal(data.clarification,'Уточнение');assert.equal(data.final,true);assert.deepEqual(payload.response_format.json_schema.schema.properties.followUp.enum,['']);
  const invalid=createWorker({now:()=>1000,fetcher:async()=>response(follow)});assert.equal((await invalid.fetch(request({questionId:'N01-001',answer:'Уточнение',context:first.context}),env)).status,502);
  assert.ok(!routerPayload({question:'Q'},'A').response_format.json_schema.schema.properties.followUp.enum);
  const old=await signContext({questionId:'N01-001',answer:'Старый ответ Groq',followUp:'Уточните',expires:2000},env.GROQ_API_KEY);
  assert.equal((await worker.fetch(request({questionId:'N01-001',answer:'Уточнение',context:old}),env)).status,200);
});

test('missing RouterAI key, forbidden origins and invalid provider never fall back to another service',async()=>{
  let calls=0;const worker=createWorker({fetcher:async()=>{calls++;return response(result);}});
  assert.equal((await worker.fetch(request(),{...env,ROUTERAI_API_KEY:''})).status,503);assert.equal((await worker.fetch(request(),{...env,GRADING_PROVIDER:'unknown'})).status,503);
  assert.equal((await worker.fetch(request(undefined,'https://untrusted.test'),env)).status,403);assert.equal(calls,0);
  assert.equal((await worker.fetch(request(),{...env,GROQ_API_KEY:undefined})).status,200);assert.equal(calls,1);
});

test('RouterAI key, balance and configuration errors are safe; rate exhaustion preserves Retry-After',async()=>{
  for(const status of [400,401,402,403,404,413,422]) {
    const reply=await createWorker({fetcher:async()=>new Response('private upstream key and transcript',{status})}).fetch(request(),env);assert.equal(reply.status,502);assert.deepEqual(await reply.json(),{error:ROUTERAI_ERRORS[status]});
  }
  const reply=await createWorker({fetcher:async()=>new Response('private',{status:429,headers:{'Retry-After':'12'}})}).fetch(request(),env);
  assert.equal(reply.status,429);assert.equal(reply.headers.get('Retry-After'),'12');assert.equal(reply.headers.get('Access-Control-Allow-Origin'),origin);assert.match((await reply.json()).error,/Лимит RouterAI/);
});

test('refused, truncated, malformed and invalid GPT-6 Luna responses do not create a grade',async()=>{
  const choices=[{finish_reason:'stop',message:{refusal:'private refusal'}},{finish_reason:'length',message:{content:'partial'}},{finish_reason:'stop',message:{content:'not JSON'}},{finish_reason:'stop',message:{content:JSON.stringify({...result,score:11})}}];
  for(const choice of choices) {
    const reply=await createWorker({fetcher:async()=>Response.json({choices:[choice]})}).fetch(request(),env);assert.equal(reply.status,502);const value=await reply.json();assert.ok(!value.result);assert.ok(!JSON.stringify(value).includes('private'));
  }
});

test('GPT-6 Luna provider and grade survive client validation, dialog import and progress reconstruction',async()=>{
  const feedback={...result,decision:'accepted'};
  const reply=await evaluateAnswer('https://worker.test/evaluate',{questionId:'N01-001',answer:'Ответ'},{fetcher:async()=>Response.json({result:feedback,context:'',provider:'routerai'})});
  const record=sanitizeVoiceRecord({turns:[{answer:'Ответ',...reply}]});assert.equal(record.turns[0].provider,'routerai');
  const q={id:'N01-001',lecture:1,origin:'new'},state=recordAnswer(freshState(),q,true,null,1000,'s');Object.assign(state.history[0],{assessment:'routerai',score:8});
  const clean=validateImport(state,[q]);assert.equal(clean.history[0].assessment,'routerai');assert.equal(clean.history[0].score,8);state.history[0].score=2;assert.throws(()=>validateImport(state,[q]),/оценка/);
});

test('the RouterAI grading key is never used for microphone transcription on Groq',async()=>{
  let sent;const form=new FormData();form.append('questionId','N01-001');form.append('file',new Blob([new Uint8Array(1000)],{type:'audio/mp4'}),'answer.m4a');
  const serialized=new Response(form),headers=new Headers(serialized.headers);headers.set('Origin',origin);
  const req=new Request('https://worker.test/transcribe',{method:'POST',headers,body:await serialized.arrayBuffer()});
  const reply=await createWorker({fetcher:async(url,options)=>{sent={url,...options};return Response.json({text:'Расшифровка'});}}).fetch(req,env);
  assert.equal(reply.status,200);assert.equal(sent.url,'https://api.groq.com/openai/v1/audio/transcriptions');assert.equal(sent.headers.Authorization,'Bearer '+env.GROQ_API_KEY);assert.deepEqual(await reply.json(),{text:'Расшифровка'});
});
