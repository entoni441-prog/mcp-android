import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inspectRecoveryAdmission} from './recovery-admission.mjs';
import {initializeRecoveryBudget,claimRecoveryAttempt} from './recovery-budget.mjs';
import {prepareOperation,beginExternalOperation,confirmOperation} from './operation-journal.mjs';

const THREAD='01a1b063-cea9-7f92-b205-1ce6e22a5d27';
const TASK='auditor_task';
const OP='sample_001';
const TICKS='638000000000000123'; // must not round via Number()
async function fixture(t,stage='PREPARED'){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-admission-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await Promise.all(['state','owner'].map(x=>fs.mkdir(path.join(root,x))));
  await initializeRecoveryBudget(root,TASK);
  await fs.writeFile(path.join(root,'native-epoch-000.json'),
    '{"taskId":"'+TASK+'","epoch":0,"restartCount":0,"ownerPid":3124,"ownerStartTicks":'+TICKS+'}\n');
  await fs.writeFile(path.join(root,'native-job-assigned-e0.txt'),
    'taskId='+TASK+'\nownerPid=3124\nownerStartTicks='+TICKS+
    '\nchildPid=3175\nchildStartTicks=638000000000000124\njobAssigned=1\ninheritedHandles=0\nbreakaway=0\n');
  await fs.writeFile(path.join(root,'state','state.json'),
    JSON.stringify({taskId:TASK,threadId:THREAD,status:'RUNNING'}));
  const identity={taskId:TASK,operationId:OP,epoch:0};
  if(stage!=='UNREGISTERED')await prepareOperation(path.join(root,'state'),identity);
  if(['IN_FLIGHT','COMMITTED'].includes(stage))await beginExternalOperation(path.join(root,'state'),identity);
  if(stage==='COMMITTED')await confirmOperation(path.join(root,'state'),identity,
    {verified:true,externalId:'abc_test_receipt'});
  return {root,taskId:TASK,threadId:THREAD,operationId:OP};
}
test('missing evidence cannot accidentally authorize a resume',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-admission-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  assert.equal((await inspectRecoveryAdmission({root,taskId:TASK,threadId:THREAD,operationId:OP})).decision,'STOP');
});
test('valid PREPARED receipt still demands live OS Job attestation',async t=>{
  const e=await fixture(t);
  assert.deepEqual(await inspectRecoveryAdmission(e),
    {decision:'REQUIRES_ATTESTATION',reason:'LIVE_OS_JOB_PROOF_REQUIRED',
      previousEpoch:0,nextEpoch:1,operationStage:'PREPARED'});
});
test('a committed operation is not whole-task success and requires external confirmation',async t=>{
  const e=await fixture(t,'COMMITTED');
  assert.deepEqual(await inspectRecoveryAdmission(e),
    {decision:'REQUIRES_ATTESTATION',reason:'EXTERNAL_RECEIPT_AND_LIVE_OS_JOB_PROOF_REQUIRED',
      previousEpoch:0,nextEpoch:1,operationStage:'COMMITTED'});
});
test('uncertain IN_FLIGHT must STOP, even if native job receipt exists',async t=>{
  const e=await fixture(t,'IN_FLIGHT');
  assert.deepEqual(await inspectRecoveryAdmission(e),
    {decision:'STOP',reason:'RECONCILIATION_REQUIRED'});
});
test('unknown operation cannot resume',async t=>{
  const e=await fixture(t,'UNREGISTERED');
  assert.equal((await inspectRecoveryAdmission(e)).reason,'OPERATION_NOT_REGISTERED');
});
test('owner STOP supersedes any committed operation',async t=>{
  const e=await fixture(t,'COMMITTED');
  await fs.writeFile(path.join(e.root,'owner','owner-stop.json'),'{}');
  assert.equal((await inspectRecoveryAdmission(e)).reason,'OWNER_STOP');
});
test('repeated attempt is not admitted after budget is burned',async t=>{
  const e=await fixture(t);
  await claimRecoveryAttempt(e.root,TASK,1);
  assert.equal((await inspectRecoveryAdmission(e)).reason,'PRIOR_RECOVERY_ALREADY_CLAIMED');
});
test('wrong thread, task or operation are not admitted',async t=>{
  const e=await fixture(t,'COMMITTED');
  const otherThread='019a8f9b-1452-71c0-8a17-6915a0904d67';
  assert.equal((await inspectRecoveryAdmission({...e,threadId:otherThread})).reason,'SESSION_UNVERIFIED');
  assert.equal((await inspectRecoveryAdmission({...e,taskId:'other_task'})).decision,'STOP');
  assert.equal((await inspectRecoveryAdmission({...e,operationId:'unknown_001'})).reason,'OPERATION_NOT_REGISTERED');
});
test('altered native owner ticks are not rounded or accepted',async t=>{
  const e=await fixture(t);
  const p=path.join(e.root,'native-job-assigned-e0.txt');
  const old=await fs.readFile(p,'utf8');
  await fs.writeFile(p,old.replace(TICKS,'638000000000000124'));
  assert.equal((await inspectRecoveryAdmission(e)).reason,'JOB_ASSIGNMENT_UNVERIFIED');
});
test('a forged native assignment cannot by itself authorize execution',async t=>{
  const e=await fixture(t);
  const result=await inspectRecoveryAdmission(e);
  assert.notEqual(result.decision,'ELIGIBLE');
  assert.notEqual(result.decision,'CLAIMED');
});
test('completion marker is not treated as permission to rerun',async t=>{
  const e=await fixture(t,'COMMITTED');
  await fs.writeFile(path.join(e.root,'state','complete.json'),
    JSON.stringify({taskId:TASK,status:'completed'}));
  const r=await inspectRecoveryAdmission(e);
  assert.equal(r.decision,'TASK_MARKED_COMPLETED');
  assert.equal(r.reason,'REQUIRES_INDEPENDENT_COMPLETION_VALIDATION');
});
test('tampered completion marker STOPs',async t=>{
  const e=await fixture(t);
  await fs.writeFile(path.join(e.root,'state','complete.json'),
    JSON.stringify({taskId:'other',status:'completed'}));
  assert.equal((await inspectRecoveryAdmission(e)).reason,'COMPLETION_UNVERIFIED');
});
test('missing native durable assignment STOPs',async t=>{
  const e=await fixture(t);
  const p=path.join(e.root,'native-job-assigned-e0.txt');
  await fs.unlink(p);
  assert.equal((await inspectRecoveryAdmission(e)).reason,'RECOVERY_EVIDENCE_UNREADABLE');
});
test('invalid identity does not even touch the filesystem',async()=>{
  const r=await inspectRecoveryAdmission({root:'relative',taskId:TASK,threadId:THREAD,operationId:OP});
  assert.equal(r.reason,'INVALID_IDENTITY');
});

test('nonstring IDs never pass identity checks',async t=>{
  const e=await fixture(t);
  assert.equal((await inspectRecoveryAdmission({...e,taskId:null})).reason,'INVALID_IDENTITY');
  assert.equal((await inspectRecoveryAdmission({...e,operationId:0})).reason,'INVALID_IDENTITY');
  assert.equal((await inspectRecoveryAdmission({...e,threadId:1})).reason,'INVALID_IDENTITY');
});
test('unsafe native assignment path is rejected without reading through a symlink',async t=>{
  const e=await fixture(t);
  const original=path.join(e.root,'native-job-assigned-e0.txt');
  const replacement=path.join(e.root,'ordinary-evidence.txt');
  await fs.rename(original,replacement);
  try{await fs.symlink(replacement,original);}catch(err){
    if(process.platform==='win32'&&['EPERM','EACCES','UNKNOWN'].includes(err.code)){
      t.skip('Windows symlink privilege unavailable');return;
    }
    throw err;
  }
  assert.equal((await inspectRecoveryAdmission(e)).reason,'JOB_ASSIGNMENT_UNVERIFIED');
});
