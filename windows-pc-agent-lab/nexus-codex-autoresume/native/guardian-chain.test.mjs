import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const fixture=path.join(here,'guardian-integration-fixture.mjs');
const native=process.env.NEXUS_JOBHOST_EXE||path.join(os.tmpdir(),'nexus-guardian-jobhost-20261106.exe');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function folder(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-job-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return dir;
}
const file=async p=>JSON.parse(await fs.readFile(p,'utf8'));
function alive(pid){
  try{process.kill(pid,0);return true;}catch{return false;}
}
async function gone(pid){
  for(let i=0;i<100;i++){if(!alive(pid))return true;await sleep(30);}
  return !alive(pid);
}
function run(id,dir,mode,limit=12000){
  const p=spawn(native,['run',id,process.execPath,fixture,dir,mode,
    mode==='hang'?'1600':'3500',String(limit)],
    {cwd:here,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='';
  p.stdout.on('data',b=>out+=b.toString());
  p.stderr.on('data',b=>err+=b.toString());
  const ended=new Promise(resolve=>{
    p.once('close',(code,signal)=>resolve({code,signal}));
    p.once('error',e=>resolve({error:e.message}));
  });
  return {p,ended,output:()=>({out,err})};
}
async function finish(r,ms=17000){
  const v=await Promise.race([r.ended,sleep(ms).then(()=>({timeout:true}))]);
  if(v.timeout){r.p.kill('SIGKILL');throw Error('CHAIN_TIMEOUT');}
  return {...v,...r.output()};
}
async function diagnostic(dir){
  const entries=await fs.readdir(dir).catch(()=>[]);
  const readOptional=async name=>file(path.join(dir,name)).catch(()=>null);
  return {entries,entryError:await readOptional('guard-entry-error.json'),
    guardianResult:await readOptional('integration-result.json'),
    nativeResult:await readOptional('job-host-status.json')};
}
async function sha(dir){
  return crypto.createHash('sha256').update(await fs.readFile(path.join(dir,'state','effect-once.txt'))).digest('hex');
}
function platform(t){
  if(process.platform!=='win32'){t.skip('Win32 native Job Object');return false;}
  return true;
}
test('native Job -> real Guardian -> real controller -> fake Codex completes without any rescue',{timeout:22000},async t=>{
  if(!platform(t))return;
  const dir=await folder(t);
  const r=run('chain-normal-'+crypto.randomUUID().slice(0,8),dir,'normal');
  const ended=await finish(r);
  assert.equal(ended.code,0,JSON.stringify({out:ended.out,err:ended.err,diagnostic:await diagnostic(dir)}));
  const nativeState=await file(path.join(dir,'job-host-status.json'));
  const guardian=await file(path.join(dir,'integration-result.json'));
  const state=await file(path.join(dir,'state','state.json'));
  const control=await file(path.join(dir,'state','guardian-process.json'));
  const checkpoint=await file(path.join(dir,'state','checkpoint.json'));
  assert.equal(nativeState.status,'COMPLETED');
  assert.equal(nativeState.jobActive,0);
  assert.equal(guardian.status,'COMPLETED');
  assert.equal(guardian.attempt,0);
  assert.equal(state.status,'COMPLETED');
  assert.equal(checkpoint.pid,state.childPid);
  assert.notEqual(control.controllerPid,checkpoint.pid);
  assert.equal(await gone(nativeState.childPid),true);
  assert.equal(await gone(control.controllerPid),true);
  assert.equal(await gone(checkpoint.pid),true);
  assert.equal(await fs.access(path.join(dir,'state','guardian-resume-claim.json')).then(()=>true,()=>false),false);
  assert.equal((await fs.readdir(path.join(dir,'state'))).filter(x=>x==='effect-once.txt').length,1);
});
test('genuine live Guardian/controller/CLI subtree is killed on guardian heartbeat loss',{timeout:22000},async t=>{
  if(!platform(t))return;
  const dir=await folder(t);
  const r=run('chain-hang-'+crypto.randomUUID().slice(0,8),dir,'hang');
  const ended=await finish(r);
  assert.equal(ended.code,20,JSON.stringify({out:ended.out,err:ended.err,diagnostic:await diagnostic(dir)}));
  const nativeState=await file(path.join(dir,'job-host-status.json'));
  const state=await file(path.join(dir,'state','state.json'));
  const control=await file(path.join(dir,'state','guardian-process.json'));
  const checkpoint=await file(path.join(dir,'state','checkpoint.json'));
  const observed=await file(path.join(dir,'hang-observed.json'));
  assert.equal(observed.controllerAndCliAlive,true);
  assert.equal(nativeState.reason,'HEARTBEAT_STALE_JOB_EMPTY');
  assert.equal(nativeState.jobActive,0);
  assert.equal(state.status,'RUNNING');
  assert.equal(checkpoint.pid,state.childPid);
  assert.equal(await gone(nativeState.childPid),true);
  assert.equal(await gone(control.controllerPid),true);
  assert.equal(await gone(checkpoint.pid),true);
  assert.equal((await fs.readdir(path.join(dir,'state'))).filter(x=>x==='effect-once.txt').length,1);
  assert.equal(await fs.access(path.join(dir,'state','guardian-resume-claim.json')).then(()=>true,()=>false),false);
  const hash=await sha(dir);
  // The native watchdog's cleanup MUST NOT be mistaken for authorization to
  // restart an already claimed task. Same directory => duplicate claim STOP.
  const again=run('chain-hang-new-'+crypto.randomUUID().slice(0,8),dir,'hang',7000);
  const repeat=await finish(again,10000);
  assert.notEqual(repeat.code,0);
  assert.equal(await sha(dir),hash,'already performed effect must not repeat');
  assert.equal((await fs.readdir(path.join(dir,'state'))).filter(x=>x==='effect-once.txt').length,1);
});
