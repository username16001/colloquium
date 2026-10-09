import test from 'node:test';
import assert from 'node:assert/strict';
import {checkForUpdate} from '../web/updates.mjs';

test('unchanged registration reports no update', async () => {
  assert.equal(await checkForUpdate({update:async()=>{}}), 'none');
});
test('ready update remains available offline without another download', async () => {
  assert.equal(await checkForUpdate({waiting:{},update:()=>{throw Error('Unexpected download');}}, {online:false}), 'ready');
});
test('missing registration and offline checks have distinct results', async () => {
  assert.equal(await checkForUpdate(null), 'unavailable');
  assert.equal(await checkForUpdate({update:()=>{throw Error('Unexpected download');}}, {online:false}), 'offline');
});
test('new version is ready only after installation has finished', async () => {
  const worker=new EventTarget();worker.state='installing';
  const registration={update:async()=>{
    registration.installing=worker;
    setTimeout(()=>{registration.waiting=worker;worker.state='installed';worker.dispatchEvent(new Event('statechange'));},5);
  }};
  assert.equal(await checkForUpdate(registration), 'ready');
});
test('failed installation is not reported as no update', async () => {
  const worker=new EventTarget();worker.state='installing';
  const registration={installing:worker,update:async()=>{
    setTimeout(()=>{worker.state='redundant';worker.dispatchEvent(new Event('statechange'));},5);
  }};
  assert.equal(await checkForUpdate(registration), 'failed');
});
test('stalled install ends the check and removes its listener', async () => {
  const worker=new EventTarget();worker.state='installing';let removed=0;
  const remove=worker.removeEventListener.bind(worker);
  worker.removeEventListener=(...args)=>{removed++;return remove(...args);};
  assert.equal(await checkForUpdate({installing:worker,update:async()=>{}},{timeoutMs:5}), 'failed');
  assert.equal(removed,1);
});
test('network failure is not reported as no update', async () => {
  assert.equal(await checkForUpdate({update:async()=>{throw Error('Network failed');}}), 'failed');
});
