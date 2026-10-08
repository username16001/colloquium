import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {freshState,recordAnswer} from '../web/study.mjs';
import {openStorage} from '../web/storage.mjs';
const q={id:'N01-001',lecture:1,origin:'new'}, questions=[q];
function environment(withDb=true){const values=new Map();return {indexedDB:withDb?new IDBFactory():null,localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},values};}
test('IndexedDB snapshot roundtrip includes actual answer history',async()=>{
  const e=environment(),a=await openStorage(questions,e),s=recordAnswer(a.state,q,true,'know',1000,'one');s.updatedAt=1000;await a.save(s);a.close();
  const b=await openStorage(questions,e);assert.equal(b.mode,'indexeddb');assert.equal(b.state.history.length,1);assert.equal(b.state.progress[q.id].correct,1);b.close();
});
test('queued rapid saves retain newest full snapshot',async()=>{
  const e=environment(),a=await openStorage(questions,e),first=freshState(),second=freshState();first.settings.theme='dark';second.settings.count=20;
  await Promise.all([a.save(first),a.save(second)]);a.close();const b=await openStorage(questions,e);assert.equal(b.state.settings.count,20);assert.equal(b.state.settings.theme,'system');assert.equal(b.state.revision,2);b.close();
});
test('another tab cannot silently overwrite newer progress',async()=>{
  const e=environment(),a=await openStorage(questions,e),b=await openStorage(questions,e),s=freshState();s.settings.count=20;await a.save(s);
  await assert.rejects(b.save(freshState()),/другой вкладке/);a.close();b.close();const c=await openStorage(questions,e);assert.equal(c.state.settings.count,20);c.close();
});
test('old studied/difficult marks migrate without invented correctness',async()=>{
  const e=environment();e.values.set('python-colloquium-v1',JSON.stringify({[q.id]:{studied:true,difficult:true}}));
  const a=await openStorage(questions,e);assert.equal(a.state.progress[q.id].studied,true);assert.equal(a.state.history.length,0);assert.equal(a.state.progress[q.id].mastered,undefined);a.close();
});
test('localStorage fallback survives reopen',async()=>{
  const e=environment(false),a=await openStorage(questions,e);await a.save(recordAnswer(a.state,q,false,null,1000,'one'));
  assert.equal(a.mode,'localstorage');const b=await openStorage(questions,e);assert.equal(b.state.progress[q.id].errors,1);
});
test('quota failure is visible; previous stored data survives',async()=>{
  const e=environment(false),a=await openStorage(questions,e);await a.save(freshState());const raw=e.values.get('python-colloquium-v2');e.localStorage.setItem=()=>{throw Error('quota');};
  await assert.rejects(a.save(recordAnswer(a.state,q,true,null,1000,'one')),/только в памяти/);assert.equal(e.values.get('python-colloquium-v2'),raw);assert.equal(a.mode,'memory');
});
test('invalid schema and invalid JSON are quarantined without overwriting',async()=>{
  for(const raw of ['{"schemaVersion":99,"progress":{},"history":[]}','{broken']){
    const e=environment(false);e.values.set('python-colloquium-v2',raw);const a=await openStorage(questions,e);assert.equal(a.mode,'readonly');assert.ok(a.rawBackup);
    await assert.rejects(a.save(freshState()));assert.equal(e.values.get('python-colloquium-v2'),raw);
  }
});
