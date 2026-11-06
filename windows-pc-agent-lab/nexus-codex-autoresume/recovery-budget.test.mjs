import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  initializeRecoveryBudget,inspectRecoveryBudget,claimRecoveryAttempt,assessStableReset
} from './recovery-budget.mjs';

async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-recovery-budget-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return dir;
}
test('budget must be initialized before a claim',async t=>{
  const dir=await fixture(t);
  assert.equal((await inspectRecoveryBudget(dir,'task_01')).reason,'BUDGET_NOT_INITIALIZED');
  assert.equal((await claimRecoveryAttempt(dir,'task_01',1)).reason,'BUDGET_NOT_INITIALIZED');
});
test('durable initialization creates a single-use anchor',async t=>{
  const dir=await fixture(t);
  assert.equal((await initializeRecoveryBudget(dir,'task_01')).remaining,5);
  assert.equal((await inspectRecoveryBudget(dir,'task_01')).nextEpoch,1);
  await assert.rejects(initializeRecoveryBudget(dir,'task_01'),e=>e.code==='EEXIST');
});
test('one recovery attempt is durably claimed before process launch',async t=>{
  const dir=await fixture(t);await initializeRecoveryBudget(dir,'task_01');
  const receipt=await claimRecoveryAttempt(dir,'task_01',1);
  assert.deepEqual(receipt,{decision:'CLAIMED',epoch:1,attempt:1,remaining:4});
  assert.equal((await inspectRecoveryBudget(dir,'task_01')).used,1);
  assert.equal((await claimRecoveryAttempt(dir,'task_01',1)).reason,'EPOCH_MISMATCH');
  assert.equal((await fs.readdir(dir)).includes('budget-attempt-001.json'),true);
});
test('five attempts persist, the sixth never starts',async t=>{
  const dir=await fixture(t);await initializeRecoveryBudget(dir,'task_01');
  for(let n=1;n<=5;n++){
    const result=await claimRecoveryAttempt(dir,'task_01',n);
    assert.equal(result.attempt,n);
    assert.equal(result.remaining,5-n);
  }
  const s=await inspectRecoveryBudget(dir,'task_01');
  assert.equal(s.used,5);assert.equal(s.remaining,0);
  assert.equal((await claimRecoveryAttempt(dir,'task_01',6)).reason,'EPOCH_INVALID');
  assert.equal((await claimRecoveryAttempt(dir,'task_01',5)).reason,'BUDGET_EXHAUSTED');
});
test('parallel attempts for same generation yield exactly one receipt',async t=>{
  const dir=await fixture(t);await initializeRecoveryBudget(dir,'task_01');
  const out=await Promise.all(Array.from({length:16},()=>claimRecoveryAttempt(dir,'task_01',1)));
  assert.equal(out.filter(x=>x.decision==='CLAIMED').length,1);
  assert.ok(out.filter(x=>x.decision==='STOP').every(x=>
    ['ATTEMPT_ALREADY_CLAIMED','EPOCH_MISMATCH'].includes(x.reason)));
  assert.equal((await inspectRecoveryBudget(dir,'task_01')).used,1);
});
test('reboot-like new reader sees consumed claim without PID or memory',async t=>{
  const dir=await fixture(t);await initializeRecoveryBudget(dir,'task_01');
  await claimRecoveryAttempt(dir,'task_01',1);
  const receipt=JSON.parse(await fs.readFile(path.join(dir,'budget-attempt-001.json'),'utf8'));
  assert.equal(receipt.epoch,1);
  assert.equal((await inspectRecoveryBudget(dir,'task_01')).nextEpoch,2);
});
test('wrong task id cannot reuse a budget',async t=>{
  const dir=await fixture(t);await initializeRecoveryBudget(dir,'task_01');
  assert.equal((await inspectRecoveryBudget(dir,'task_02')).reason,'BUDGET_CORRUPT');
});
test('out-of-order epoch is rejected',async t=>{
  const dir=await fixture(t);await initializeRecoveryBudget(dir,'task_01');
  assert.equal((await claimRecoveryAttempt(dir,'task_01',3)).reason,'EPOCH_MISMATCH');
  assert.equal((await inspectRecoveryBudget(dir,'task_01')).used,0);
});
test('tampered attempt cannot be used for a subsequent claim',async t=>{
  const dir=await fixture(t);await initializeRecoveryBudget(dir,'task_01');
  await claimRecoveryAttempt(dir,'task_01',1);
  const f=path.join(dir,'budget-attempt-001.json');
  const data=JSON.parse(await fs.readFile(f,'utf8'));data.prevHash='0'.repeat(64);
  await fs.writeFile(f,JSON.stringify(data));
  assert.equal((await inspectRecoveryBudget(dir,'task_01')).reason,'BUDGET_CORRUPT');
  assert.equal((await claimRecoveryAttempt(dir,'task_01',2)).reason,'BUDGET_CORRUPT');
});
test('missing intermediate receipt is fail-closed',async t=>{
  const dir=await fixture(t);await initializeRecoveryBudget(dir,'task_01');
  await claimRecoveryAttempt(dir,'task_01',1);
  await claimRecoveryAttempt(dir,'task_01',2);
  await fs.unlink(path.join(dir,'budget-attempt-001.json'));
  assert.equal((await inspectRecoveryBudget(dir,'task_01')).reason,'BUDGET_GAP');
});
test('extra receipt after fifth attempt is rejected as overflow',async t=>{
  const dir=await fixture(t);await initializeRecoveryBudget(dir,'task_01');
  await fs.writeFile(path.join(dir,'budget-attempt-006.json'),'{}');
  assert.equal((await inspectRecoveryBudget(dir,'task_01')).reason,'BUDGET_GAP');
});
test('unpublished temporary budget record is rejected pending reconciliation',async t=>{
  const dir=await fixture(t);await initializeRecoveryBudget(dir,'task_01');
  await fs.writeFile(path.join(dir,'budget-attempt-001.json.crash.tmp'),'partial');
  assert.equal((await inspectRecoveryBudget(dir,'task_01')).reason,'BUDGET_UNKNOWN_RECEIPT');
});
test('symbolic anchor is never considered a durable receipt',async t=>{
  const dir=await fixture(t),external=path.join(dir,'other.json');
  await fs.writeFile(external,'{}');
  try{await fs.symlink(external,path.join(dir,'budget-anchor.json'));}
  catch(e){if(process.platform==='win32'&&['EPERM','EACCES','UNKNOWN'].includes(e.code)){t.skip('Symlink privilege unavailable');return;}throw e;}
  assert.equal((await inspectRecoveryBudget(dir,'task_01')).reason,'BUDGET_UNREADABLE');
});
test('stable reset requires full uninterrupted 30-minute OS evidence',()=>{
  const e={sameBoot:true,exclusiveJobContinuouslyOwned:true,
    heartbeatContinuouslyVerified:true,ownerStopAbsent:true,
    processTreeStable:true,monotonicObservedMs:1799999};
  assert.equal(assessStableReset(e).reason,'STABILITY_WINDOW_INCOMPLETE');
  assert.equal(assessStableReset({...e,monotonicObservedMs:1800000}).decision,'NEEDS_NATIVE_ATTESTATION');
  assert.equal(assessStableReset({...e,sameBoot:false}).reason,'STABILITY_NOT_PROVEN');
  assert.equal(assessStableReset({...e,heartbeatContinuouslyVerified:false}).reason,'STABILITY_NOT_PROVEN');
});
test('reset assessment cannot mutate durable budget or restore attempts',async t=>{
  const dir=await fixture(t);await initializeRecoveryBudget(dir,'task_01');
  await claimRecoveryAttempt(dir,'task_01',1);
  const e={sameBoot:true,exclusiveJobContinuouslyOwned:true,
    heartbeatContinuouslyVerified:true,ownerStopAbsent:true,
    processTreeStable:true,monotonicObservedMs:9000000};
  assert.equal(assessStableReset(e).decision,'NEEDS_NATIVE_ATTESTATION');
  assert.equal((await inspectRecoveryBudget(dir,'task_01')).used,1);
  assert.equal((await inspectRecoveryBudget(dir,'task_01')).remaining,4);
});
