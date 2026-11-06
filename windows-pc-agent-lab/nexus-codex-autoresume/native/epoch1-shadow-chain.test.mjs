// Windows-only SHADOW recovery admission. This test never runs actual Codex,
// replays an external operation or enables GuardianJobHost recover mode.
// Only a synthetic PREPARED receipt is allowed through the OS-observation gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {inspectRecoveryAdmissionWithKernel} from '../recovery-admission.mjs';
import {claimRecoveryAttempt,inspectRecoveryBudget} from '../recovery-budget.mjs';
import {getOperation,beginExternalOperation} from '../operation-journal.mjs';
import {observeKernelJob} from '../kernel-job-observation.mjs';

const dirOfFile=path.dirname(fileURLToPath(import.meta.url));
const fixture=path.join(dirOfFile,'guardian-integration-fixture.mjs');
const exe=process.env.NEXUS_JOBHOST_EXE;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const op='local_effect_001';
const exec=promisify(execFile);
async function reserve(task,root){
  try{
    const r=await exec(exe,['reserve-shadow',task,root],{
      cwd:dirOfFile,windowsHide:true,timeout:8000,maxBuffer:2048
    });
    return {exitCode:0,response:JSON.parse(r.stdout.trim())};
  }catch(e){
    return {exitCode:Number(e.code)||99,response:JSON.parse(String(e.stdout||'{}').trim())};
  }
}

async function temp(t){
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-job-test-'));
  t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  return folder;
}
async function until(file,ready=()=>true,ms=7500){
  const end=Date.now()+ms;
  while(Date.now()<end){
    try{const row=JSON.parse(await fs.readFile(file,'utf8'));if(ready(row))return row;}catch{}
    await wait(35);
  }
  throw Error('PREPARED_RECEIPT_NOT_READY:'+path.basename(file));
}
function live(pid){try{process.kill(pid,0);return true;}catch{return false;}}
async function gone(pid,ms=6000){
  const end=Date.now()+ms;
  while(Date.now()<end){if(!live(pid))return true;await wait(40);}
  return !live(pid);
}
function start(task,root){
  const child=spawn(exe,['run',task,process.execPath,fixture,root,'prepared','7000','23000'],
    {cwd:dirOfFile,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let out='',err='';
  child.stdout.on('data',x=>out+=x.toString());
  child.stderr.on('data',x=>err+=x.toString());
  const exit=new Promise(resolve=>{
    child.once('exit',(code,signal)=>resolve({code,signal}));
    child.once('error',e=>resolve({error:e.code||'SPAWN_ERROR'}));
  });
  return {child,exit,output:()=>({out,err})};
}
async function terminated(p){
  p.child.kill('SIGKILL');
  const dead=await Promise.race([p.exit,wait(6000).then(()=>({timeout:true}))]);
  p.child.stdout.destroy();p.child.stderr.destroy();p.child.unref();
  return dead;
}
const supported=t=>{
  if(process.platform!=='win32'||!exe){t.skip('Windows native test exe required');return false;}
  return true;
};
test('OS Job death + exact session journal + single epoch-1 SHADOW claim, never run Codex',{timeout:25000},async t=>{
  if(!supported(t))return;
  const root=await temp(t);
  const task='shadow-'+crypto.randomUUID().slice(0,8);
  const owner=start(task,root);
  t.after(()=>{if(owner.child.exitCode===null)owner.child.kill('SIGKILL');});
  const ready=await until(path.join(root,'synthetic-prepared-ready.json'));
  const status=await until(path.join(root,'job-host-status.json'),x=>x.status==='RUNNING');
  assert.equal(ready.taskId,task);
  assert.equal(ready.noExternalEffect,true);
  assert.equal(ready.guardianStarted,false);
  assert.ok(live(status.ownerPid)&&live(status.childPid));
  const whileOwnerAlive=await reserve(task,root);
  assert.equal(whileOwnerAlive.exitCode,12);
  assert.equal(whileOwnerAlive.response.reason,'DUPLICATE_OWNER');

  const sha=crypto.createHash('sha256').update(await fs.readFile(exe)).digest('hex');
  const args={root,taskId:task,threadId:ready.threadId,operationId:op,nativeExe:exe,expectedSha256:sha};
  const before=await inspectRecoveryAdmissionWithKernel(args);
  assert.equal(before.decision,'STOP');
  assert.equal(before.reason,'JOB_OBJECT_STILL_PRESENT');
  assert.equal((await inspectRecoveryBudget(root,task)).used,0);
  assert.equal((await getOperation(path.join(root,'state'),{
    taskId:task,operationId:op,epoch:0})).stage,'PREPARED');

  const killed=await terminated(owner);
  assert.equal(killed.timeout,undefined,JSON.stringify({...owner.output(),killed}));
  assert.equal(await gone(status.childPid),true);
  let osProof;
  const deadline=Date.now()+5000;
  do{
    osProof=await observeKernelJob({root,taskId:task,nativeExe:exe,expectedSha256:sha});
    if(osProof.decision==='OS_OBSERVATION_ONLY')break;
    await wait(35);
  }while(Date.now()<deadline);
  assert.equal(osProof.decision,'OS_OBSERVATION_ONLY',JSON.stringify(osProof));
  assert.equal(osProof.canResume,false);
  const staged=await inspectRecoveryAdmissionWithKernel(args);
  assert.equal(staged.decision,'REQUIRES_ATTESTATION',JSON.stringify(staged));
  assert.equal(staged.operationStage,'PREPARED');
  assert.equal(staged.kernelJobObservedMissing,true);
  assert.equal(staged.canResume,false);
  assert.equal(await fs.access(path.join(root,'state','effect-once.txt')).then(()=>true,()=>false),false);

  // Under TEST supervision only: consume a durable epoch-1 accounting claim.
  // This does NOT create native-epoch-001 or launch a recovery process.
  const consumed=await claimRecoveryAttempt(root,task,1);
  assert.deepEqual(consumed,{decision:'CLAIMED',epoch:1,attempt:1,remaining:4});
  // Even when the budget is already burned, a SYNTHETIC UUID must never
  // enter the real read-only Codex recovery launcher.
  const alternate=path.join(dirOfFile,'real-readonly-resume-fixture.mjs');
  let refused;
  try{
    const r=await exec(exe,['run',task,process.execPath,alternate,root,
      'resume-readonly','8000','17000'],{
        cwd:dirOfFile,timeout:8000,windowsHide:true,maxBuffer:2048
      });
    refused={exitCode:0,stdout:r.stdout};
  }catch(e){refused={exitCode:Number(e.code)||99,stdout:String(e.stdout||'')};}
  assert.equal(refused.exitCode,24,'synthetic-only UUID MUST NOT launch a real CLI');
  assert.match(refused.stdout,/E1_READONLY_PREFLIGHT_DENIED/);
  assert.equal(await fs.access(path.join(root,'native-epoch-001.json')).then(()=>true,()=>false),false);
  const nativeShadow=await reserve(task,root);
  assert.equal(nativeShadow.exitCode,0,JSON.stringify(nativeShadow));
  assert.deepEqual(nativeShadow.response,{
    status:'SHADOW_EPOCH_RESERVED',epoch:1,canResume:false
  });
  const receipt=JSON.parse(await fs.readFile(path.join(root,'native-epoch-001-shadow.json'),'utf8'));
  assert.equal(receipt.shadowOnly,true);
  assert.equal(receipt.oldKernelJobGone,true);
  assert.equal(receipt.canResume,false);
  assert.equal(receipt.budgetAttempt,1);
  const duplicate=await reserve(task,root);
  assert.equal(duplicate.exitCode,17);
  assert.equal(duplicate.response.reason,'SHADOW_EPOCH_ALREADY_CLAIMED');
  assert.equal((await inspectRecoveryBudget(root,task)).used,1);
  assert.equal((await claimRecoveryAttempt(root,task,1)).decision,'STOP');
  assert.equal((await inspectRecoveryAdmissionWithKernel(args)).reason,'PRIOR_RECOVERY_ALREADY_CLAIMED');
  assert.equal(await fs.access(path.join(root,'native-epoch-001.json')).then(()=>true,()=>false),false);
  assert.equal(await fs.access(path.join(root,'state','effect-once.txt')).then(()=>true,()=>false),false);
});
test('IN_FLIGHT uncertainty stops at the journal before any budget claim',{timeout:23000},async t=>{
  if(!supported(t))return;
  const root=await temp(t),task='shadow-unknown-'+crypto.randomUUID().slice(0,8);
  const owner=start(task,root);
  t.after(()=>{if(owner.child.exitCode===null)owner.child.kill('SIGKILL');});
  const ready=await until(path.join(root,'synthetic-prepared-ready.json'));
  const status=await until(path.join(root,'job-host-status.json'),x=>x.status==='RUNNING');
  // This is a synthetic uncertainty marker, NOT an actual external API call.
  await beginExternalOperation(path.join(root,'state'),{taskId:task,operationId:op,epoch:0});
  const killed=await terminated(owner);
  assert.equal(killed.timeout,undefined);
  assert.equal(await gone(status.childPid),true);
  const sha=crypto.createHash('sha256').update(await fs.readFile(exe)).digest('hex');
  const review=await inspectRecoveryAdmissionWithKernel({
    root,taskId:task,threadId:ready.threadId,operationId:op,
    nativeExe:exe,expectedSha256:sha
  });
  assert.deepEqual(review,{decision:'STOP',reason:'RECONCILIATION_REQUIRED'});
  const nativeReject=await reserve(task,root);
  assert.notEqual(nativeReject.exitCode,0);
  assert.equal(nativeReject.response.reason,'OPERATION_EFFECT_BOUNDARY_UNPROVEN');
  assert.equal(await fs.access(path.join(root,'native-epoch-001-shadow.json')).then(()=>true,()=>false),false);
  assert.equal((await inspectRecoveryBudget(root,task)).used,0);
  assert.equal(await fs.access(path.join(root,'budget-attempt-001.json')).then(()=>true,()=>false),false);
});
