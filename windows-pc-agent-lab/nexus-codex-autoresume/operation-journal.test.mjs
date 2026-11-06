import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareOperation,beginExternalOperation,confirmOperation,getOperation,recoveryDisposition} from './operation-journal.mjs';

async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nx-journal-'));
  t.after(()=>fs.rm(dir,{force:true,recursive:true}));
  return {dir,id:{taskId:'safe-task',operationId:'op1',epoch:1}};
}
test('prepare -> IN_FLIGHT -> verified COMMITTED, each durable immutable receipt',async t=>{
  const f=await fixture(t);
  assert.deepEqual(await prepareOperation(f.dir,f.id),{stage:'PREPARED'});
  assert.equal((await getOperation(f.dir,f.id)).stage,'PREPARED');
  assert.deepEqual(await recoveryDisposition(f.dir,f.id,1),{decision:'ELIGIBLE_TO_START_ONCE',reason:'NOT_YET_IN_FLIGHT'});
  assert.deepEqual(await beginExternalOperation(f.dir,f.id),{stage:'IN_FLIGHT'});
  assert.deepEqual(await recoveryDisposition(f.dir,f.id,1),{decision:'STOP',reason:'RECONCILIATION_REQUIRED'});
  await assert.rejects(confirmOperation(f.dir,f.id,{verified:false,externalId:'receipt1'}),/RECEIPT_UNVERIFIED/);
  assert.deepEqual(await confirmOperation(f.dir,f.id,{verified:true,externalId:'receipt1'}),{stage:'COMMITTED'});
  assert.deepEqual(await recoveryDisposition(f.dir,f.id,1),{decision:'COMPLETE',reason:'RECEIPT_EXISTS'});
  assert.equal((await getOperation(f.dir,f.id)).externalId,'receipt1');
  const items=(await fs.readdir(f.dir)).sort();
  assert.equal(items.length,3);
  assert.ok(items.every(x=>x.endsWith('.json')&&!x.endsWith('.tmp')));
});
test('an IN_FLIGHT operation after crash must NEVER be auto-reissued',async t=>{
  const f=await fixture(t);
  await prepareOperation(f.dir,f.id);
  await beginExternalOperation(f.dir,f.id);
  assert.deepEqual(await recoveryDisposition(f.dir,f.id,2),{decision:'STOP',reason:'RECONCILIATION_REQUIRED'});
  await assert.rejects(beginExternalOperation(f.dir,f.id),/NOT_PREPARED/);
});
test('exclusive durable publication rejects duplicate prepared and second commit',async t=>{
  const f=await fixture(t);
  await prepareOperation(f.dir,f.id);
  await assert.rejects(prepareOperation(f.dir,f.id),e=>e.code==='EEXIST');
  await beginExternalOperation(f.dir,f.id);
  await confirmOperation(f.dir,f.id,{verified:true,externalId:'receipt1'});
  await assert.rejects(confirmOperation(f.dir,f.id,{verified:true,externalId:'receipt2'}),/NOT_IN_FLIGHT/);
});
test('old epoch COMMITTED cannot complete a new epoch operation',async t=>{
  const f=await fixture(t);
  await prepareOperation(f.dir,f.id);
  await beginExternalOperation(f.dir,f.id);
  await confirmOperation(f.dir,f.id,{verified:true,externalId:'receipt1'});
  const next={...f.id,epoch:2};
  assert.equal((await getOperation(f.dir,next)).stage,'UNREGISTERED');
  assert.deepEqual(await recoveryDisposition(f.dir,next,2),{decision:'STOP',reason:'NO_SAFE_AUTOMATIC_ACTION'});
});
test('unknown epoch or missing operation does not auto execute',async t=>{
  const f=await fixture(t);
  assert.deepEqual(await recoveryDisposition(f.dir,f.id,1),{decision:'STOP',reason:'NO_SAFE_AUTOMATIC_ACTION'});
  assert.deepEqual(await recoveryDisposition(f.dir,f.id,0),{decision:'STOP',reason:'EPOCH_UNVERIFIED'});
});
test('invalid IDs and untrusted receipt never persist',async t=>{
  const f=await fixture(t);
  await assert.rejects(prepareOperation(f.dir,{...f.id,operationId:'../../x'}),/BAD_ID/);
  await assert.rejects(prepareOperation(f.dir,{...f.id,epoch:-1}),/BAD_ID/);
  assert.deepEqual(await fs.readdir(f.dir),[]);
});
test('tampered journal goes to STOP through a rejected read',async t=>{
  const f=await fixture(t);
  await prepareOperation(f.dir,f.id);
  const file=(await fs.readdir(f.dir))[0];
  await fs.writeFile(path.join(f.dir,file),JSON.stringify({taskId:'wrong',operationId:'op1',epoch:1,stage:'PREPARED'}));
  await assert.rejects(getOperation(f.dir,f.id),/JOURNAL_MISMATCH/);
});
test('hard-link publication is race-safe across concurrent writers',async t=>{
  const f=await fixture(t);
  const result=await Promise.allSettled([prepareOperation(f.dir,f.id),prepareOperation(f.dir,f.id)]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(result.filter(x=>x.status==='rejected').length,1);
  assert.equal((await getOperation(f.dir,f.id)).stage,'PREPARED');
});
