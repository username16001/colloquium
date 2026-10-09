import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../backend/worker.mjs';
import {MAX_AUDIO_BYTES} from '../web/voice.mjs';
const origin='https://username16001.github.io';
const env={GROQ_API_KEY:'test-key-only',ALLOWED_ORIGINS:origin,VOICE_RATE_LIMIT:{limit:async()=>({success:true})}};
async function request({questionId='N01-001',type='audio/mp4',bytes=1000,host=origin,extra=false}={}) {
  const body=new FormData();body.append('questionId',questionId);body.append('file',new Blob([new Uint8Array(bytes)],{type}),'answer.m4a');body.append('model','untrusted-model');body.append('url','https://untrusted.test/audio');
  if(extra)body.append('file',new Blob(['extra'],{type}),'extra.m4a');
  const serialized=new Response(body);
  const headers=new Headers(serialized.headers);headers.set('Origin',host);
  return new Request('https://worker.test/transcribe',{method:'POST',headers,body:await serialized.arrayBuffer()});
}
test('MP4 audio is transcribed with the server key and fixed Russian Whisper settings, not evaluated',async()=>{
  let sent;const worker=createWorker({fetcher:async(url,options)=>{sent={url,...options};return Response.json({text:'  Список изменяемый.  '});}});
  const response=await worker.fetch(await request(),env);assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);assert.deepEqual(await response.json(),{text:'Список изменяемый.'});
  assert.equal(sent.url,'https://api.groq.com/openai/v1/audio/transcriptions');assert.equal(sent.headers.Authorization,'Bearer test-key-only');assert.ok(!sent.headers['Content-Type']);
  assert.equal(sent.body.get('model'),'whisper-large-v3-turbo');assert.equal(sent.body.get('language'),'ru');assert.equal(sent.body.get('url'),null);assert.equal(sent.body.get('file').type,'audio/mp4');
});
test('WebM recordings and CORS preflight are supported',async()=>{
  const worker=createWorker({fetcher:async()=>Response.json({text:'Ответ'})});
  assert.equal((await worker.fetch(await request({type:'audio/webm;codecs=opus'}),env)).status,200);
  const preflight=new Request('https://worker.test/transcribe',{method:'OPTIONS',headers:{Origin:origin}});
  assert.equal((await worker.fetch(preflight,env)).status,204);
});
test('untrusted origin, wrong question, empty or multiple files, unsupported format and oversized body never reach Groq',async()=>{
  let calls=0;const worker=createWorker({fetcher:async()=>{calls++;return Response.json({text:'text'});}});
  for(const [options,status] of [[{host:'https://untrusted.test'},403],[{questionId:'missing'},400],[{bytes:0},400],[{extra:true},400],[{type:'text/plain'},415],[{bytes:MAX_AUDIO_BYTES+20000},413]]) {
    assert.equal((await worker.fetch(await request(options),env)).status,status);
  }
  assert.equal(calls,0);
});
test('transcription handles rate limits, empty text and provider failures without leaking credentials or audio',async()=>{
  for(const fetcher of [async()=>new Response('private transcript and secret',{status:401}),async()=>{throw Error('private secret');},async()=>Response.json({text:''}),async()=>Response.json({text:'x'.repeat(6001)})]) {
    const response=await createWorker({fetcher}).fetch(await request(),env);assert.equal(response.status,502);assert.ok(!JSON.stringify(await response.json()).includes('secret'));
  }
  const response=await createWorker({fetcher:async()=>new Response('',{status:429,headers:{'Retry-After':'15'}})}).fetch(await request(),env);
  assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'15');
});
