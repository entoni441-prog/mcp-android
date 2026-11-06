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
  assert.equal(live.status,'PRESENT',JSON.stringify(live));
  assert.ok(live.active>=1);
  assert.equal(live.authorization,'NONE');
  const stopped=await waitClosed(running,16000);
  assert.equal(stopped.code,20,JSON.stringify({...running.getOutput(),stopped}));
  const after=await observe(task,dir);
  assert.deepEqual(after,{status:'NOT_FOUND',authorization:'NONE'});
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
