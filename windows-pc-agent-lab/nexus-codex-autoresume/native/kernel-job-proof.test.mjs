// Real Win32 named Job lifecycle proof, test-only sandbox.
// Never launches real Codex, changes a Scheduler task or touches NEXUS Host.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {observeKernelJob} from '../kernel-job-observation.mjs';

const call=promisify(execFile);
const here=path.dirname(fileURLToPath(import.meta.url));
const fixture=path.join(here,'guardian-integration-fixture.mjs');
const native=process.env.NEXUS_JOBHOST_EXE||path.join(os.tmpdir(),'nexus-guardian-jobhost-20261106.exe');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function scratch(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-job-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return dir;
}
function start(task,dir,mode){
  const p=spawn(native,['run',task,process.execPath,fixture,dir,mode,
    mode==='hang'?'2000':'4000','13000'],
    {cwd:here,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  p.stdout.on('data',d=>stdout+=d.toString());
  p.stderr.on('data',d=>stderr+=d.toString());
  const result=new Promise(resolve=>{
    p.once('close',(code,signal)=>resolve({code,signal}));
    p.once('error',e=>resolve({error:e.message}));
  });
  return {p,result,getOutput:()=>({stdout,stderr})};
}
async function awaitJson(file,fn=()=>true,ms=8000){
  const end=Date.now()+ms;
  while(Date.now()<end){
    try{const value=JSON.parse(await fs.readFile(file,'utf8'));if(fn(value))return value;}catch{}
    await sleep(35);
  }
  throw Error('TEST_RECEIPT_TIMEOUT:'+path.basename(file));
}
async function observe(task,dir){
  const r=await call(native,['probe',task,dir],{cwd:here,windowsHide:true,timeout:12000});
  return JSON.parse(r.stdout.trim());
}
async function waitClosed(p,ms=15000){
  return Promise.race([p.result,sleep(ms).then(()=>({timeout:true}))]);
}
async function waitGone(pid,ms=4000){
  const end=Date.now()+ms;
  while(Date.now()<end){
    try{process.kill(pid,0);}catch{return true;}
    await sleep(40);
  }
  try{process.kill(pid,0);return false;}catch{return true;}
}
async function diagnostic(dir){
  const read=async rel=>fs.readFile(path.join(dir,...rel.split('/')),'utf8').then(v=>{
    try{return JSON.parse(v);}catch{return v.slice(0,850);}
  }).catch(()=>null);
  return {
    nativeStatus:await read('job-host-status.json'),
    guardianResult:await read('integration-result.json'),
    controllerState:await read('state/state.json'),
    controllerReceipt:await read('state/guardian-process.json'),
    cliCheckpoint:await read('state/checkpoint.json'),
    hangObserved:await read('hang-observed.json'),
    controllerHang:await read('controller-hang-observed.json'),
    entryError:await read('guard-entry-error.json')
  };
}
function supported(t){if(process.platform!=='win32'){t.skip('Win32 kernel lifecycle');return false;}return true;}
test('kernel-backed named job is PRESENT while Guardian runs and NOT_FOUND after watchdog cleanup',{timeout:22000},async t=>{
  if(!supported(t))return;
  const dir=await scratch(t),task='jobproof-hang-'+crypto.randomUUID().slice(0,8);
  const running=start(task,dir,'hang');
  t.after(()=>{if(running.p.exitCode===null)running.p.kill();});
  const receipt=await awaitJson(path.join(dir,'job-host-status.json'),r=>r.status==='RUNNING');
  const assignment=await fs.readFile(path.join(dir,'native-job-assigned-e0.txt'),'utf8');
  assert.match(assignment,/jobAssigned=1/);
  const live=await observe(task,dir);
  const pinned=crypto.createHash('sha256').update(await fs.readFile(native)).digest('hex');
  const activeProof=await observeKernelJob({root:dir,taskId:task,nativeExe:native,expectedSha256:pinned});
  assert.equal(activeProof.decision,'STOP');
  assert.equal(activeProof.reason,'JOB_OBJECT_STILL_PRESENT');
  assert.equal(live.status,'PRESENT',JSON.stringify(live));
  assert.ok(live.active>=1);
  assert.equal(live.authorization,'NONE');
  const stopped=await waitClosed(running,16000);
  assert.equal(stopped.code,20,JSON.stringify({...running.getOutput(),stopped,diagnostic:await diagnostic(dir)}));
  const after=await observe(task,dir);
  assert.deepEqual(after,{status:'NOT_FOUND',authorization:'NONE'});
  const kernel=await observeKernelJob({root:dir,taskId:task,nativeExe:native,expectedSha256:pinned});
  assert.deepEqual(kernel,{decision:'OS_OBSERVATION_ONLY',
    reason:'JOB_NOT_FOUND_IN_CURRENT_SESSION',canResume:false});
  assert.equal(await waitGone(receipt.childPid),true);
});
test('SIGKILL of exact native owner removes named Job and every owned descendant',{timeout:16000},async t=>{
  if(!supported(t))return;
  const dir=await scratch(t),task='jobproof-kill-'+crypto.randomUUID().slice(0,8);
  const running=start(task,dir,'hang');
  t.after(()=>{if(running.p.exitCode===null)running.p.kill();});
  const receipt=await awaitJson(path.join(dir,'job-host-status.json'),r=>r.status==='RUNNING');
  assert.equal((await observe(task,dir)).status,'PRESENT');
  running.p.kill('SIGKILL'); // only the exact test process we just created
  const exit=await waitClosed(running,8000);
  assert.ok(!exit.timeout,'native owner failed to terminate');
  const deadline=Date.now()+6500;let outcome;
  do{outcome=await observe(task,dir);if(outcome.status==='NOT_FOUND')break;await sleep(50);}
  while(Date.now()<deadline);
  assert.deepEqual(outcome,{status:'NOT_FOUND',authorization:'NONE'});
  assert.equal(await waitGone(receipt.childPid),true);
});
test('missing independent job receipt is STOP, never a positive disappearance proof',{timeout:2000},async t=>{
  if(!supported(t))return;
  const dir=await scratch(t),task='jobproof-missing-'+crypto.randomUUID().slice(0,8);
  const r=await call(native,['probe',task,dir],{cwd:here,windowsHide:true,timeout:1500})
    .catch(e=>({stdout:e.stdout,code:e.code}));
  assert.equal(JSON.parse(r.stdout.trim()).reason,'JOB_IDENTITY_MISSING');
});
test('probe refuses invalid task IDs and non-fixture directories',{timeout:2000},async t=>{
  if(!supported(t))return;
  const dir=await scratch(t);
  const r=await call(native,['probe','wrong/task',dir],{cwd:here,windowsHide:true,timeout:1500})
    .catch(e=>({stdout:e.stdout,code:e.code}));
  assert.ok(!String(r.stdout).includes('NOT_FOUND'));
});

test('extra OS Job handle keeps the tree alive after owner death; probe must block restart',{timeout:23000},async t=>{
  if(!supported(t))return;
  const dir=await scratch(t),task='jobproof-held-'+crypto.randomUUID().slice(0,8);
  const owner=start(task,dir,'hang');
  t.after(()=>{if(owner.p.exitCode===null)owner.p.kill();});
  const receipt=await awaitJson(path.join(dir,'job-host-status.json'),s=>s.status==='RUNNING');
  const watcher=spawn(native,['probe-hold',task,dir,'5000'],{
    cwd:here,windowsHide:true,stdio:['ignore','pipe','pipe']
  });
  t.after(()=>{if(watcher.exitCode===null)watcher.kill();});
  let output='';
  const observed=new Promise((resolve,reject)=>{
    watcher.once('error',reject);
    watcher.stdout.on('data',d=>{
      output+=d.toString();
      if(output.includes('\n'))resolve(JSON.parse(output.trim().split(/\r?\n/)[0]));
    });
    watcher.once('close',()=>reject(Error('HOLDER_EXITED_EARLY')));
  });
  const holding=await Promise.race([observed,
    sleep(4500).then(()=>{throw Error('HOLDER_NOT_READY');})]);
  assert.equal(holding.status,'PRESENT');
  assert.equal(holding.authorization,'NONE');
  owner.p.kill('SIGKILL');
  const dead=await waitClosed(owner,5000);
  assert.equal(dead.timeout,undefined);
  const whileHeld=await observe(task,dir);
  assert.equal(whileHeld.status,'PRESENT');
  assert.ok(whileHeld.active>=1);
  assert.equal(whileHeld.authorization,'NONE');
  // While another handle exists the kernel MUST NOT be declared empty merely
  // because the original owner PID has died.
  assert.equal(await waitGone(receipt.childPid,150),false);
  await new Promise(resolve=>watcher.once('close',resolve));
  const end=Date.now()+4000;let gone;
  do{gone=await observe(task,dir);if(gone.status==='NOT_FOUND')break;await sleep(40);}
  while(Date.now()<end);
  assert.deepEqual(gone,{status:'NOT_FOUND',authorization:'NONE'});
  assert.equal(await waitGone(receipt.childPid),true);
});

test('pinned native probe refuses wrong checksum and missing OS receipt',{timeout:3500},async t=>{
  if(!supported(t))return;
  const dir=await scratch(t),task='jobproof-negative-'+crypto.randomUUID().slice(0,8);
  const sha=crypto.createHash('sha256').update(await fs.readFile(native)).digest('hex');
  const wrong=await observeKernelJob({root:dir,taskId:task,nativeExe:native,
    expectedSha256:'0'.repeat(64)});
  assert.deepEqual(wrong,{decision:'STOP',reason:'PROBE_BINARY_MISMATCH'});
  const missing=await observeKernelJob({root:dir,taskId:task,nativeExe:native,
    expectedSha256:sha});
  assert.deepEqual(missing,{decision:'STOP',reason:'PROBE_FAILED_OR_UNCERTAIN'});
});
