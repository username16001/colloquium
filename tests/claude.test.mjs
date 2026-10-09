import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../backend/worker.mjs';
import {CLAUDE_ERRORS,claudePayload} from '../backend/claude.mjs';
import {evaluateAnswer,sanitizeVoiceRecord} from '../web/voice.mjs';
import {freshState,recordAnswer,validateImport} from '../web/study.mjs';

const origin='https://username16001.github.io';
const env={GRADING_PROVIDER:'anthropic',ANTHROPIC_API_KEY:'test-anthropic-only',GROQ_API_KEY:'test-groq-only',ALLOWED_ORIGINS:origin,VOICE_RATE_LIMIT:{limit:async()=>({success:true})}};
const result={score:8,summary:'Суть верна.',strengths:['Верный механизм.'],errors:[],additions:[],followUp:''};
const request=(body={questionId:'N01-001',answer:'Ответ'})=>new Request('https://worker.test/evaluate',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const response=value=>Response.json({stop_reason:'end_turn',content:[{type:'thinking',signature:'private-thinking'},{type:'text',text:JSON.stringify(value)}]});

test('Claude grading uses a server key, trusted reference, structured output and Haiku 5.5 parameters',async()=>{
  let sent;const worker=createWorker({fetcher:async(url,options)=>{sent={url,...options};return response(result);}});
  const reply=await worker.fetch(request({questionId:'N01-001',answer:'Ответ',reference:'Поддельный эталон',provider:'groq',model:'untrusted'}),env);
  assert.equal(reply.status,200);const value=await reply.json();assert.equal(value.provider,'anthropic');assert.equal(value.result.score,8);assert.equal(value.result.decision,'accepted');
  assert.equal(sent.url,'https://api.anthropic.com/v1/messages');assert.equal(sent.headers['x-api-key'],env.ANTHROPIC_API_KEY);assert.equal(sent.headers['anthropic-version'],'2023-06-01');assert.ok(!sent.headers.Authorization);
  const body=JSON.parse(sent.body);assert.equal(body.model,'claude-haiku-5-5');assert.equal(body.output_config.effort,'low');assert.equal(body.max_tokens,4096);
  assert.equal(body.output_config.format.type,'json_schema');assert.equal(body.output_config.format.schema.additionalProperties,false);assert.ok(!('temperature' in body));assert.ok(!('top_p' in body));assert.ok(!('top_k' in body));assert.ok(!body.tools);
  assert.equal(body.messages.length,1);assert.notEqual(JSON.parse(body.messages[0].content).reference,'Поддельный эталон');assert.match(body.system,/Не требуй дословного/);
  assert.ok(!JSON.stringify(value).includes('test-anthropic'));assert.ok(!JSON.stringify(value).includes('private-thinking'));
});

test('Claude clarification preserves the signed first answer and allows only one final assessment',async()=>{
  const follow={...result,score:5,followUp:'Что происходит при изменении?'};let sent;
  const worker=createWorker({now:()=>1000,fetcher:async(url,options)=>{sent=JSON.parse(options.body);return response(JSON.parse(sent.messages[0].content).final?result:follow);}});
  const first=await (await worker.fetch(request(),env)).json();assert.equal(first.result.decision,'follow_up');assert.ok(first.context);
  const final=await (await worker.fetch(request({questionId:'N01-001',answer:'Уточнение',context:first.context}),env)).json();
  assert.equal(final.result.decision,'accepted');assert.equal(final.context,'');const data=JSON.parse(sent.messages[0].content);assert.equal(data.first_answer,'Ответ');assert.equal(data.clarification,'Уточнение');assert.deepEqual(sent.output_config.format.schema.properties.followUp.enum,['']);
  assert.ok(!claudePayload({question:'Q'},'A').output_config.format.schema.properties.followUp.enum);
  const invalid=createWorker({now:()=>1000,fetcher:async()=>response(follow)});assert.equal((await invalid.fetch(request({questionId:'N01-001',answer:'Уточнение',context:first.context}),env)).status,502);
});

test('an existing Groq clarification remains valid after switching grading to Claude',async()=>{
  const firstWorker=createWorker({now:()=>1000,fetcher:async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...result,score:5,followUp:'Уточните ответ'})}}]})});
  const first=await (await firstWorker.fetch(request(),{...env,GRADING_PROVIDER:'groq'})).json();
  const final=await createWorker({now:()=>1000,fetcher:async()=>response(result)}).fetch(request({questionId:'N01-001',answer:'Уточнение',context:first.context}),env);
  assert.equal(final.status,200);assert.equal((await final.json()).provider,'anthropic');
});

test('Claude needs its own key and never silently sends a failed check to Groq',async()=>{
  let calls=0;const worker=createWorker({fetcher:async()=>{calls++;return response(result);}});
  assert.equal((await worker.fetch(request(),{...env,ANTHROPIC_API_KEY:''})).status,503);assert.equal((await worker.fetch(request(),{...env,GRADING_PROVIDER:'unknown'})).status,503);assert.equal(calls,0);
  const typed=await worker.fetch(request(),{...env,GROQ_API_KEY:undefined});assert.equal(typed.status,200);assert.equal(calls,1);
});

test('Claude errors, refusals and partial responses never turn into grades or leak upstream content',async()=>{
  for(const status of [400,401,403,404,413,529]) {
    const reply=await createWorker({fetcher:async()=>new Response('private upstream key and answer',{status})}).fetch(request(),env);
    assert.equal(reply.status,502);assert.deepEqual(await reply.json(),{error:CLAUDE_ERRORS[status]});
  }
  for(const data of [{stop_reason:'refusal',content:[{type:'text',text:'private refusal'}]},{stop_reason:'max_tokens',content:[{type:'text',text:'partial'}]},{stop_reason:'end_turn',content:[{type:'thinking'}]},{stop_reason:'end_turn',content:[{type:'text',text:'not JSON'}]}]) {
    const reply=await createWorker({fetcher:async()=>Response.json(data)}).fetch(request(),env);assert.equal(reply.status,502);const value=await reply.json();assert.ok(!value.result);assert.ok(!JSON.stringify(value).includes('private'));
  }
  const invalid=await createWorker({fetcher:async()=>response({...result,score:11})}).fetch(request(),env);assert.equal(invalid.status,502);
});

test('Claude rate exhaustion retains a safe retry delay and the same CORS policy',async()=>{
  const reply=await createWorker({fetcher:async()=>new Response('private',{status:429,headers:{'Retry-After':'12'}})}).fetch(request(),env);
  assert.equal(reply.status,429);assert.equal(reply.headers.get('Retry-After'),'12');assert.equal(reply.headers.get('Access-Control-Allow-Origin'),origin);assert.match((await reply.json()).error,/Лимит Claude/);
});

test('provider identity survives the client transport, dialog sanitization and progress import',async()=>{
  const feedback={...result,decision:'accepted'};
  const reply=await evaluateAnswer('https://worker.test/evaluate',{questionId:'N01-001',answer:'Ответ'},{fetcher:async()=>Response.json({result:feedback,context:'',provider:'anthropic'})});assert.equal(reply.provider,'anthropic');
  const record=sanitizeVoiceRecord({turns:[{answer:'Ответ',...reply}]});assert.equal(record.turns[0].provider,'anthropic');
  const legacy=sanitizeVoiceRecord({turns:[{answer:'Ответ',result:feedback,context:''}]});assert.equal(legacy.turns[0].provider,'groq');
  await assert.rejects(evaluateAnswer('https://worker.test/evaluate',{answer:'Ответ'},{fetcher:async()=>Response.json({result:feedback,context:'',provider:'untrusted'})}),/Некорректный/);
  const q={id:'N01-001',lecture:1,origin:'new'},state=recordAnswer(freshState(),q,true,null,1000,'s');Object.assign(state.history[0],{assessment:'claude',score:8});
  const clean=validateImport(state,[q]);assert.equal(clean.history[0].assessment,'claude');assert.equal(clean.history[0].score,8);state.history[0].score=2;assert.throws(()=>validateImport(state,[q]),/оценка/);
});

test('audio transcription still uses Whisper on Groq when Claude evaluates the text',async()=>{
  let urlUsed,keyUsed;const form=new FormData();form.append('questionId','N01-001');form.append('file',new Blob([new Uint8Array(1000)],{type:'audio/mp4'}),'answer.m4a');
  const serialized=new Response(form),headers=new Headers(serialized.headers);headers.set('Origin',origin);
  const req=new Request('https://worker.test/transcribe',{method:'POST',headers,body:await serialized.arrayBuffer()});
  const reply=await createWorker({fetcher:async(url,options)=>{urlUsed=url;keyUsed=options.headers.Authorization;return Response.json({text:'Расшифровка'});}}).fetch(req,env);
  assert.equal(reply.status,200);assert.equal(urlUsed,'https://api.groq.com/openai/v1/audio/transcriptions');assert.equal(keyUsed,'Bearer '+env.GROQ_API_KEY);assert.deepEqual(await reply.json(),{text:'Расшифровка'});
});
