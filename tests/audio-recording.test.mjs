import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioRecording,preferAudioRecording,transcribeAudio,MAX_AUDIO_BYTES,createDictation} from '../web/voice.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup({transcribe=async()=> 'Распознанный ответ',getUserMedia}={}) {
  let instance,stops=0,text='',error='';const states=[];
  const stream={getTracks:()=>[{stop:()=>stops++}]};
  class Recorder {
    static isTypeSupported(type){return type==='audio/mp4';}
    constructor(source,options){assert.equal(source,stream);this.mimeType=options.mimeType;this.state='inactive';instance=this;}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.ondataavailable({data:new Blob(['synthetic audio'],{type:this.mimeType})});this.onstop();}
  }
  const recorder=createAudioRecording({environment:{MediaRecorder:Recorder,navigator:{mediaDevices:{getUserMedia:getUserMedia||(async()=>stream)}}},transcribe,onText:v=>text=v,onStatus:v=>states.push(v),onError:v=>error=v});
  return {recorder,stream,states,get instance(){return instance;},get stops(){return stops;},get text(){return text;},get error(){return error;}};
}
test('installed iPhone and iPad apps prefer audio recording; ordinary browsers retain speech recognition',()=>{
  assert.equal(preferAudioRecording({navigator:{userAgent:'iPhone',standalone:true}}),true);
  assert.equal(preferAudioRecording({navigator:{platform:'MacIntel',maxTouchPoints:5},matchMedia:()=>({matches:true})}),true);
  assert.equal(preferAudioRecording({navigator:{userAgent:'iPhone',standalone:false}}),false);
  assert.equal(preferAudioRecording({navigator:{userAgent:'Windows'},matchMedia:()=>({matches:true})}),false);
});
test('recording keeps the microphone until Stop, uses MP4 and returns an editable transcript with its prefix',async()=>{
  let received;const s=setup({transcribe:async blob=>{received=blob;return 'Список изменяемый.';}});
  await s.recorder.start('Начало ответа.');assert.equal(s.recorder.phase,'recording');assert.equal(s.instance.state,'recording');assert.equal(s.stops,0);assert.equal(s.text,'');
  s.recorder.stop();await tick();assert.equal(received.type,'audio/mp4');assert.ok(received.size);assert.ok(s.stops>0);
  assert.equal(s.text,'Начало ответа. Список изменяемый.');assert.equal(s.recorder.phase,'idle');assert.deepEqual(s.states,['permission','recording','stopping','transcribing','idle']);
});
test('cancelling a pending permission request releases a late microphone stream and sends no audio',async()=>{
  let resolve;const promise=new Promise(r=>resolve=r);let calls=0;
  const s=setup({getUserMedia:()=>promise,transcribe:async()=>{calls++;return 'text';}});
  const starting=s.recorder.start();assert.equal(s.recorder.phase,'permission');s.recorder.cancel();resolve(s.stream);await starting;
  assert.ok(s.stops>0);assert.equal(calls,0);assert.equal(s.recorder.phase,'idle');assert.equal(s.instance,undefined);
});
test('permission denial has a visible message and does not leave recording active',async()=>{
  const s=setup({getUserMedia:async()=>{throw new DOMException('denied','NotAllowedError');}});
  await s.recorder.start();assert.match(s.error,/Доступ к микрофону запрещён/);assert.equal(s.recorder.phase,'idle');
});
test('leaving a recording cancels it without uploading; late recorder events cannot overwrite the next question',async()=>{
  let calls=0;const s=setup({transcribe:async()=>{calls++;return 'text';}});
  await s.recorder.start();s.recorder.cancel();await tick();assert.ok(s.stops>0);assert.equal(calls,0);assert.equal(s.text,'');assert.equal(s.recorder.canRetry,false);
});
test('failed transcription can retry the same audio; cancellation ignores late text',async()=>{
  let calls=0;const s=setup({transcribe:async()=>{if(++calls===1)throw Error('Сбой сети');return 'Готовый текст';}});
  await s.recorder.start('Черновик');s.recorder.stop();await tick();assert.equal(s.recorder.canRetry,true);assert.equal(s.text,'');assert.equal(s.error,'Сбой сети');
  await s.recorder.retry('Исправленный черновик');assert.equal(s.text,'Исправленный черновик Готовый текст');assert.equal(s.recorder.canRetry,false);
  let finish;const late=setup({transcribe:()=>new Promise(resolve=>finish=resolve)});
  await late.recorder.start();late.recorder.stop();late.recorder.cancel();finish('Запоздавший ответ');await tick();assert.equal(late.text,'');
});
test('oversized recording stops the microphone without submitting partial audio',async()=>{
  let calls=0;const s=setup({transcribe:async()=>{calls++;return 'text';}});
  await s.recorder.start();s.instance.ondataavailable({data:new Blob([new Uint8Array(MAX_AUDIO_BYTES+1)])});await tick();
  assert.ok(s.stops>0);assert.equal(calls,0);assert.match(s.error,/слишком большая/);assert.equal(s.recorder.phase,'idle');
});
test('audio transport uses multipart and the transcription endpoint; it never sends a provider key or grades the answer',async()=>{
  let sent;const text=await transcribeAudio('https://worker.test/evaluate','N01-001',new Blob(['audio'],{type:'audio/mp4'}),{fetcher:async(url,options)=>{sent={url,...options};return Response.json({text:' Список изменяемый. '});}});
  assert.equal(text,'Список изменяемый.');assert.equal(sent.url,'https://worker.test/transcribe');assert.equal(sent.credentials,'omit');assert.ok(!sent.headers);
  assert.equal(sent.body.get('questionId'),'N01-001');assert.equal(sent.body.get('file').name,'answer.m4a');
  await assert.rejects(transcribeAudio('https://worker.test/evaluate','N01-001',new Blob()),/пустая/);
});
test('speech recognition ending immediately without any result displays a fallback message',()=>{
  let instance,message='',active;
  class Speech {constructor(){instance=this;}start(){}stop(){this.onend();}abort(){this.onend();}}
  const d=createDictation({environment:{webkitSpeechRecognition:Speech},onText:()=>{},onStatus:v=>active=v,onError:v=>message=v});
  d.start();instance.onend();assert.equal(active,false);assert.match(message,/без текста/);
  d.start();instance.onerror({error:'service-not-allowed'});assert.equal(active,false);assert.match(message,/недоступно/);
});
