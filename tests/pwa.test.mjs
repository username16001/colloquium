import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const template=readFileSync(new URL('../web/sw.template.js',import.meta.url),'utf8');
function harness(version='one',scope='https://example.test/course/',shared=new Map(),fail=null){
  const listeners={},calls={skip:0,claim:0,fetch:0};
  const key=r=>String(r.url||r), caches={async keys(){return [...shared.keys()];},async delete(k){return shared.delete(k);},async open(k){if(!shared.has(k))shared.set(k,new Map());const data=shared.get(k);return {async put(u,r){data.set(key(u),r);},async match(u,options={}){let value=key(u);if(options.ignoreSearch)value=value.split('?')[0];return data.get(value);}};}};
  const self={registration:{scope},clients:{async claim(){calls.claim++;}},skipWaiting(){calls.skip++;},addEventListener(t,fn){listeners[t]=fn;}};
  const fetch=async r=>{calls.fetch++;if(fail&&key(r).endsWith(fail))return {ok:false};return {ok:true,version,url:key(r)};};
  vm.runInNewContext(template.replace('/*__VERSION__*/',version).replace('/*__RESOURCES__*/','["./index.html","./icons/icon.png"]'),{self,caches,fetch,URL,Request});
  async function event(type,extra={}){let work;listeners[type]({...extra,waitUntil:p=>work=p,respondWith:p=>work=p});return work;}
  return {event,calls,shared,scope};
}
test('install caches required resources at Pages subpath without activating early',async()=>{
  const h=harness();await h.event('install');assert.equal(h.calls.skip,0);assert.equal(h.calls.fetch,2);
  const response=await h.event('fetch',{request:{url:h.scope+'index.html?fresh=1',method:'GET',mode:'navigate'}});assert.equal(response.version,'one');assert.equal(h.calls.fetch,2);
});
test('uncached navigation is served offline from shell',async()=>{
  const h=harness();await h.event('install');const r=await h.event('fetch',{request:{url:h.scope,method:'GET',mode:'navigate'}});assert.equal(r.version,'one');assert.equal(h.calls.fetch,2);
});
test('failed install does not replace active offline version',async()=>{
  const shared=new Map(),old=harness('one',undefined,shared),next=harness('two',undefined,shared,'icon.png');await old.event('install');
  await assert.rejects(next.event('install'),/Missing offline resource/);assert.equal(next.calls.skip,0);
  const r=await old.event('fetch',{request:{url:old.scope+'index.html',method:'GET',mode:'navigate'}});assert.equal(r.version,'one');
});
test('explicit activation removes only older caches of the same scope',async()=>{
  const shared=new Map(),old=harness('one',undefined,shared),other=harness('one','https://example.test/another/',shared),next=harness('two',undefined,shared);
  await old.event('install');await other.event('install');await next.event('install');next.event('message',{data:{type:'ACTIVATE_UPDATE'}});assert.equal(next.calls.skip,1);
  await next.event('activate');assert.equal(next.calls.claim,1);assert.equal(shared.size,2);assert.ok([...shared.keys()].some(k=>k.includes('/another/')));
});
test('worker ignores non-GET, external origins and paths outside its scope',async()=>{
  const h=harness();for(const request of [{url:h.scope,method:'POST'},{url:'https://elsewhere.test/course/',method:'GET'},{url:'https://example.test/outside/',method:'GET'}])assert.equal(await h.event('fetch',{request}),undefined);
});
