import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {queueStopNotice,listUndeliveredStopNotices} from './stop-outbox.mjs';
async function dir(t){
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-outbox-test-'));
  t.after(()=>fs.rm(d,{recursive:true,force:true}));return d;
}
test('a STOP record persists across independent reads and never claims delivery',async t=>{
  const d=await dir(t);
  assert.equal((await queueStopNotice(d,{taskId:'one',epoch:1,reason:'RECONCILIATION_REQUIRED'})).decision,'QUEUED');
  const list=await listUndeliveredStopNotices(d,'one');
  assert.equal(list.decision,'PENDING');
  assert.deepEqual(list.items,[{version:1,taskId:'one',epoch:1,status:'STOP',reason:'RECONCILIATION_REQUIRED'}]);
  assert.equal((await queueStopNotice(d,{taskId:'one',epoch:1,reason:'RECONCILIATION_REQUIRED'})).decision,'ALREADY_QUEUED');
  assert.equal((await fs.readdir(d)).length,1);
});
test('simultaneous publishers produce one durable STOP notice',async t=>{
  const d=await dir(t),event={taskId:'one',epoch:2,reason:'BUDGET_EXHAUSTED'};
  const values=await Promise.all(Array.from({length:20},()=>queueStopNotice(d,event)));
  assert.equal(values.filter(x=>x.decision==='QUEUED').length,1);
  assert.equal(values.filter(x=>x.decision==='ALREADY_QUEUED').length,19);
  assert.equal((await listUndeliveredStopNotices(d,'one')).items.length,1);
});
test('conflicting STOP reason for an epoch is not silently overwritten',async t=>{
  const d=await dir(t);
  await queueStopNotice(d,{taskId:'one',epoch:1,reason:'OWNER_STOP'});
  assert.equal((await queueStopNotice(d,{taskId:'one',epoch:1,reason:'BUDGET_EXHAUSTED'})).reason,'NOTICE_CONFLICT');
  assert.equal((await listUndeliveredStopNotices(d,'one')).items[0].reason,'OWNER_STOP');
});
test('unknown reasons do not copy sensitive details into report',async t=>{
  const d=await dir(t);
  await queueStopNotice(d,{taskId:'one',epoch:3,reason:'secret API token = MY_PRIVATE_PASSWORD'});
  const value=JSON.stringify(await listUndeliveredStopNotices(d,'one'));
  assert.ok(!value.includes('MY_PRIVATE_PASSWORD'));
  assert.match(value,/UNKNOWN_STOP/);
});
test('unknown outbox file fails closed',async t=>{
  const d=await dir(t);
  await fs.writeFile(path.join(d,'stop-notice-e0001.json.tmp'),'{}');
  assert.equal((await listUndeliveredStopNotices(d,'one')).reason,'NOTICE_UNKNOWN_FILE');
});
test('tampered or wrong-task notice cannot be treated as an event',async t=>{
  const d=await dir(t);
  await queueStopNotice(d,{taskId:'one',epoch:2,reason:'OWNER_STOP'});
  assert.equal((await listUndeliveredStopNotices(d,'two')).reason,'NOTICE_CONFLICT');
  await fs.writeFile(path.join(d,'stop-notice-e0002.json'),'{}');
  assert.equal((await listUndeliveredStopNotices(d,'one')).reason,'NOTICE_CONFLICT');
});
test('no provider can be claimed delivered through this API',async t=>{
  const d=await dir(t);
  await queueStopNotice(d,{taskId:'one',epoch:1,reason:'OWNER_STOP'});
  assert.equal((await listUndeliveredStopNotices(d,'one')).items.length,1);
  assert.equal((await listUndeliveredStopNotices(d,'one')).items.length,1);
});
