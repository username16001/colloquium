import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DAY,freshState,usable,filtered,shuffle,recordAnswer,stats,recommend,ticket,validateImport,paginateHistory} from '../web/study.mjs';
const bank=JSON.parse(readFileSync(new URL('../questions.json',import.meta.url),'utf8')).questions;
const q=bank.find(q=>q.id==='N08-002'), now=1_800_000_000_000;
const grade=(s,correct,confidence=null,at=now,id=String(at))=>recordAnswer(s,q,correct,confidence,at,id);
test('duplicate is retained in JSON and excluded from every selection',()=>{
  assert.equal(bank.length,438);assert.equal(usable(bank).length,437);
  assert.equal(filtered(bank,{origin:'original'}).length,137);
  assert.equal(filtered(bank,{origin:'new',lectures:[8],types:['Теория']}).every(r=>r.origin==='new'&&r.lecture===8&&r.type==='Теория'),true);
});
test('seed reproduces random selection without mutating bank',()=>{
  const a=shuffle(usable(bank),42);assert.deepEqual(a,shuffle(usable(bank),42));
  assert.notDeepEqual(a,shuffle(usable(bank),43));assert.equal(new Set(a.map(q=>q.id)).size,437);
});
test('fresh diagnostic set covers nine lectures with clear reasons',()=>{
  const rows=recommend(bank,freshState(),{count:9,seed:4},now);
  assert.equal(new Set(rows.map(r=>r.question.lecture)).size,9);
  assert.ok(rows.every(r=>r.reason.includes('диагностики')));
  assert.deepEqual(rows,recommend(bank,freshState(),{count:9,seed:4},now));
});
test('one grade per question and session; separate sessions retained',()=>{
  const s=grade(freshState(),true,'know');assert.equal(s.progress[q.id].attempts,1);
  assert.equal(grade(s,false,'guess',now),s);assert.equal(grade(s,false,'guess',now,'second').history.length,2);
  assert.equal(freshState().history.length,0);
});
test('confidence and mistakes set transparent review intervals',()=>{
  for(const [correct,c,interval] of [[false,'know',.25],[true,'guess',.5],[true,'unsure',1],[true,null,1],[true,'know',2]]){
    const p=grade(freshState(),correct,c).progress[q.id];assert.equal(p.intervalDays,interval);assert.equal(p.dueAt,now+DAY*interval);assert.equal(p.mastered,false);
  }
});
test('mastery requires spaced successes; guess and error reset it',()=>{
  let s=grade(freshState(),true,'know');s=grade(s,true,'know',now+1000);assert.equal(s.progress[q.id].mastered,false);
  s=grade(s,true,'know',now+DAY/2);assert.equal(s.progress[q.id].mastered,true);
  s=grade(s,false,'know',now+DAY);assert.equal(s.progress[q.id].mastered,false);
  s=grade(s,true,'guess',now+2*DAY);assert.equal(s.progress[q.id].spacedSuccesses,0);
});
test('repeated correct answers grow intervals with a 60 day cap',()=>{
  let s=freshState();for(let i=0;i<12;i++)s=grade(s,true,'know',now+i*DAY);
  assert.equal(s.progress[q.id].intervalDays,60);
});
test('rapid rereading does not inflate review intervals or mastery',()=>{
  let s=freshState();for(let i=0;i<10;i++)s=grade(s,true,'know',now+i*1000);
  assert.equal(s.progress[q.id].intervalDays,2);assert.equal(s.progress[q.id].mastered,false);
});
test('incorrect confidence cannot count as mastery; first and repeated statistics separate',()=>{
  let s=grade(freshState(),false,'know');s=grade(s,true,null,now+DAY);
  const a=stats(bank,s,now+3*DAY);assert.equal(a.seen,1);assert.equal(a.first,1);assert.equal(a.firstCorrect,0);assert.equal(a.correct,1);assert.equal(a.attempts,2);assert.equal(a.due,1);
});
test('scheduling favors errors, weak confidence, due dates and explains choice',()=>{
  const s=grade(freshState(),false,'know',now-DAY);
  const selected=recommend(bank,s,{count:1},now)[0];assert.equal(selected.question.id,q.id);assert.match(selected.reason,/ошибка/);assert.match(selected.reason,/срок/);
  assert.equal(recommend(bank,s,{smartMode:'errors',count:100},now).length,1);
  assert.equal(recommend(bank,s,{smartMode:'new',count:100},now).some(r=>r.question.id===q.id),false);
  assert.equal(recommend(bank,s,{smartMode:'review'},now)[0].question.id,q.id);
});
test('recently repeated questions lose priority and final review includes originals',()=>{
  const s=grade(freshState(),true,'know');assert.notEqual(recommend(bank,s,{count:1},now+1000)[0].question.id,q.id);
  assert.equal(recommend(bank,freshState(),{count:9,finalReview:true},now).every(r=>r.question.origin==='original'),true);
});
test('three-part ticket uses theory, code, reasoning from three lectures',()=>{
  for(let seed=0;seed<40;seed++){
    const rows=ticket(bank,seed);assert.equal(rows.length,3);assert.equal(rows[0].type,'Теория');assert.equal(rows[1].type,'Понимание кода');assert.equal(new Set(rows.map(q=>q.lecture)).size,3);
  }
  assert.deepEqual(ticket([q]),[]);
});
test('progress roundtrip preserves marks, settings, confidence and pending session',()=>{
  const s=grade(freshState(),true,'guess');s.progress[q.id].favorite=true;s.settings.theme='dark';
  s.session={id:'pending',mode:'practice',ids:[q.id],index:0,createdAt:now,finished:false,revealed:{[q.id]:true},responded:[],ratings:{},confidence:{[q.id]:'unsure'},reasons:{[q.id]:'Повторение'}};
  const r=validateImport(JSON.parse(JSON.stringify(s)),bank);
  assert.deepEqual(r.progress,s.progress);assert.equal(r.settings.theme,'dark');assert.equal(r.session.confidence[q.id],'unsure');assert.equal(r.session.revealed[q.id],true);
});
test('unfinished exam import removes reveals and fabricated ratings',()=>{
  const s=freshState();s.session={id:'exam',mode:'exam',ids:[q.id],index:0,createdAt:now,finished:false,revealed:{[q.id]:true},ratings:{[q.id]:{correct:true}},responded:[q.id]};
  const r=validateImport(s,bank);assert.equal(r.session.revealed[q.id],false);assert.deepEqual(r.session.ratings,{});
});
test('finished exam retains unfinished grading after restoration',()=>{
  const s=grade(freshState(),true,null,now,'exam');s.session={id:'exam',mode:'exam',ids:[q.id],index:0,createdAt:now,finished:true,completed:false,revealed:{},ratings:{},responded:[q.id]};
  const r=validateImport(s,bank);assert.equal(r.session.completed,false);assert.equal(r.session.finished,true);assert.equal(r.session.ratings[q.id].correct,true);
});
test('weak lectures have explained priorities; empty sessions are rejected',()=>{
  let s=freshState();const qs=bank.filter(r=>r.origin==='new'&&r.lecture===1);
  for(let i=0;i<3;i++)s=recordAnswer(s,qs[i],false,null,now-DAY,'weak-'+i);
  assert.ok(recommend(bank,s,{smartMode:'weak',lectures:[1],count:5},now).every(r=>r.reason.includes('лекции')));
  const empty=freshState();empty.session={id:'bad',mode:'practice',ids:[],index:0};assert.throws(()=>validateImport(empty,bank),/сессия/);
});
test('harder material gains priority after spaced mastery of half a lecture',()=>{
  const qs=usable(bank).filter(r=>r.lecture===1), easy=qs.filter(q=>q.difficulty!=='Сложные');
  let s=freshState();
  for(const row of easy){s=recordAnswer(s,row,true,'know',now-DAY,'first-'+row.id);s=recordAnswer(s,row,true,'know',now-DAY/2,'second-'+row.id);}
  assert.ok(stats(qs,s,now).mastered>qs.length/2);
  assert.equal(recommend(qs,s,{count:1},now)[0].question.difficulty,'Сложные');
});
test('invalid imports fail before replacing data and cannot invent mastery',()=>{
  const s=grade(freshState(),true,null);const copy=structuredClone(s);copy.progress[q.id].mastered=true;copy.progress[q.id].spacedSuccesses=100;
  assert.equal(validateImport(copy,bank).progress[q.id].mastered,false);
  for(const mutate of [s=>s.schemaVersion=2,s=>s.progress[q.id].attempts=-1,s=>s.progress[q.id].correct=8,s=>s.history.push(s.history[0]),s=>s.history[0].confidence='certain',s=>s.history=[]]){
    const bad=structuredClone(s);mutate(bad);assert.throws(()=>validateImport(bad,bank));
  }
  assert.equal(s.history.length,1);
});
test('unknown IDs and hostile keys cannot introduce questions or object properties',()=>{
  const s=freshState();s.progress=JSON.parse('{"__proto__":{"favorite":true},"unknown":{"attempts":1}}');
  assert.deepEqual(validateImport(s,bank).progress,{});assert.equal({}.favorite,undefined);
});


test('history pagination shows at most five newest grades and retains the source history',()=>{
  const history=Array.from({length:34},(_,i)=>({questionId:String(i),at:i}));
  const first=paginateHistory(history),last=paginateHistory(history,5);
  assert.deepEqual(first.rows.map(a=>a.at),[33,32,31,30,29]);
  assert.deepEqual(last.rows.map(a=>a.at),[8,7,6,5,4]);
  assert.equal(first.pages,6);assert.equal(first.total,30);
  assert.equal(history.length,34);assert.equal(history[0].at,0);
});
test('history pagination clamps pages and handles short or empty history',()=>{
  assert.deepEqual(paginateHistory([],8),{rows:[],page:0,pages:1,total:0});
  const history=Array.from({length:6},(_,i)=>({at:i}));
  assert.deepEqual(paginateHistory(history,99).rows,[{at:0}]);
  assert.equal(paginateHistory(history,-1).page,0);
  assert.equal(paginateHistory(history,NaN).page,0);
});
