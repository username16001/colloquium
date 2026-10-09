import test from 'node:test';
import assert from 'node:assert/strict';
import {createDictation,evaluateAnswer,validateFeedback} from '../web/voice.mjs';
import {freshState,recordAnswer,validateImport} from '../web/study.mjs';
import {openStorage} from '../web/storage.mjs';
import {IDBFactory} from 'fake-indexeddb';
const accepted={score:8,decision:'accepted',summary:'Суть верна.',strengths:['Верный механизм.'],errors:[],additions:['Можно уточнить термин.'],followUp:''};
const follow={...accepted,score:5,decision:'follow_up',followUp:'Что происходит при изменении?'};
test('feedback requires consistent scores, bounded lists and only one follow-up',()=>{
  assert.equal(validateFeedback(accepted).score,8);
  for(const value of [{...accepted,score:5},{...accepted,score:NaN},{...follow,score:2},{...accepted,errors:['x'.repeat(1001)]},{...accepted,followUp:'extra'}])assert.throws(()=>validateFeedback(value));
  assert.throws(()=>validateFeedback(follow,true));
});
test('transport sends only question ID, answer and signed continuation without a provider key',async()=>{
  let sent;
  const result=await evaluateAnswer('https://worker.test/evaluate',{questionId:'N01-001',answer:'Мой ответ',context:''},{fetcher:async(url,options)=>{sent={url,...options};return Response.json({result:accepted,context:''});}});
  assert.equal(result.result.decision,'accepted');assert.equal(sent.credentials,'omit');
  assert.deepEqual(JSON.parse(sent.body),{questionId:'N01-001',answer:'Мой ответ',context:''});assert.ok(!sent.headers.Authorization);
});
test('transport rejects unavailable endpoints, blank/large answers and malformed evaluations',async()=>{
  const payload={questionId:'N01-001',answer:'Ответ'};
  await assert.rejects(evaluateAnswer('',payload),/не подключён/);
  await assert.rejects(evaluateAnswer('http://unsafe.test/evaluate',payload),/защищённый/);
  await assert.rejects(evaluateAnswer('https://worker.test/evaluate',{answer:' '}),/Сначала/);
  await assert.rejects(evaluateAnswer('https://worker.test/evaluate',{answer:'x'.repeat(6001)}),/Сократите/);
  await assert.rejects(evaluateAnswer('https://worker.test/evaluate',payload,{fetcher:async()=>Response.json({error:'Подождите.'},{status:429})}),/Подождите/);
  await assert.rejects(evaluateAnswer('https://worker.test/evaluate',payload,{fetcher:async()=>Response.json({result:follow,context:''})}),/Некорректный/);
});
test('dictation retains prefix and replaces interim results instead of duplicating them',()=>{
  let instance,text='',active;
  class Speech {constructor(){instance=this;}start(){}stop(){this.onend();}abort(){this.onend();}}
  const voice=createDictation({environment:{webkitSpeechRecognition:Speech},onText:v=>text=v,onStatus:v=>active=v,onError:()=>{}});
  voice.start('Уже написано');assert.equal(active,true);assert.equal(instance.lang,'ru-RU');
  instance.onresult({results:[[{transcript:'изменяемый'}]]});
  instance.onresult({results:[[{transcript:'изменяемый объект'}]]});
  assert.equal(text,'Уже написано изменяемый объект');voice.stop();assert.equal(active,false);
});
test('cancel ignores late speech callbacks; permission errors provide a typing fallback',()=>{
  let instance,text='',message='';
  class Speech {constructor(){instance=this;}start(){}abort(){}stop(){}}
  const voice=createDictation({environment:{SpeechRecognition:Speech},onText:v=>text=v,onStatus:()=>{},onError:v=>message=v});
  voice.start();instance.onerror({error:'not-allowed'});assert.match(message,/запрещён/);
  voice.cancel();instance.onresult({results:[[{transcript:'late'}]]});assert.equal(text,'');
  const missing=createDictation({environment:{}});assert.equal(missing.supported,false);assert.throws(()=>missing.start(),/напечатать/);
});
test('voice session, transcript, follow-up and AI history survive storage reopening',async()=>{
  const q={id:'N01-001',lecture:1,origin:'new'},env={indexedDB:new IDBFactory(),localStorage:{getItem:()=>null,setItem:()=>{}}};
  const storage=await openStorage([q],env),s=recordAnswer(freshState(),q,true,null,1000,'voice');
  Object.assign(s.history[0],{assessment:'groq',score:8});
  s.session={id:'voice',mode:'voice',ids:[q.id],index:0,createdAt:1000,finished:false,revealed:{},responded:[],ratings:{},confidence:{},reasons:{},oral:{[q.id]:{draft:'Первый ответ',followDraft:'Уточнение',turns:[{answer:'Первый ответ',result:follow,context:'signed'},{answer:'Уточнение',result:accepted,context:''}]}}};
  await storage.save(s);storage.close();const restored=await openStorage([q],env);
  assert.equal(restored.state.history[0].score,8);assert.equal(restored.state.session.oral[q.id].turns.length,2);assert.equal(restored.state.session.ratings[q.id].correct,true);
  assert.equal(recordAnswer(restored.state,q,true,null,2000,'voice').history.length,1);
  restored.close();const bad=structuredClone(s);bad.history[0].score=4;assert.throws(()=>validateImport(bad,[q]),/оценка/);
});
test('pending dictation and clarification survive import without inventing a grade',()=>{
  const q={id:'N01-001',lecture:1,origin:'new'},s=freshState();
  s.session={id:'v',mode:'voice',ids:[q.id],index:0,revealed:{},responded:[],oral:{[q.id]:{draft:'Первый ответ',followDraft:'Черновик',turns:[{answer:'Первый ответ',result:follow,context:'signed'}]}}};
  const clean=validateImport(s,[q]);assert.equal(clean.history.length,0);assert.equal(clean.session.oral[q.id].followDraft,'Черновик');assert.deepEqual(clean.session.ratings,{});
});
