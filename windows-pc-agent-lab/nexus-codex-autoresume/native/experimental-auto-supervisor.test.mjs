// Acceptance of a truly observing (not manually invoked after crash) test
// supervisor. Windows CI only runs synthetic negative tests. The positive
// REAL Codex test runs only when NEXUS_TEST_CODEX_EXE is explicitly supplied.
// No Scheduler, service, production tasks or user Codex sessions are modified.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {beginExternalOperation} from '../operation-journal.mjs';
import {inspectRecoveryBudget} from '../recovery-budget.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const native=process.env.NEXUS_JOBHOST_EXE;
const cli=process.env.NEXUS_TEST_CODEX_EXE;
const supervisorScript=path.join(here,'experimental-auto-supervisor.mjs');
const realFixture=path.join(here,'real-readonly-fixture.mjs');
const syntheticFixture=path.join(here,'guardian-integration-fixture.mjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=async f=>crypto.createHash('sha256').update(await fs.readFile(f)).digest('hex');
const file=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const available=async f=>fs.access(f).then(()=>true,()=>false);
function executable(p,args,cwd=here){
  const child=spawn(p,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let text='',err='',events=[];
  child.stdout.on('data',d=>{
    text+=d.toString();
    let i;
    while((i=text.indexOf('\n'))>=0){
      const line=text.slice(0,i);text=text.slice(i+1);
      try{events.push(JSON.parse(line));}catch{}
    }
  });
  child.stderr.on('data',d=>{err=(err+d.toString()).slice(-1200)});
  const ended=new Promise(resolve=>{
    child.once('exit',(code,signal)=>resolve({code,signal}));
    child.once('error',e=>resolve({error:e.code||'SPAWN_ERROR'}));
  });
  return {child,events,ended,get err(){return err;}};
}
async function waitUntil(predicate,timeoutMs,label){
  const stop=Date.now()+timeoutMs;
  while(Date.now()<stop){
    const result=await predicate();
    if(result)return result;
    await delay(45);
  }
  throw Error('TIMEOUT_'+label);
}
async function receipt(f){try{return await file(f);}catch{return null;}}
function bounded(p,ms){
  let timer;
  return Promise.race([p,new Promise(resolve=>{
    timer=setTimeout(()=>resolve({timeout:true}),ms);
  })]).finally(()=>clearTimeout(timer));
}
function dispose(run){
  if(!run)return;
  if(run.child.exitCode===null)try{run.child.kill('SIGKILL');}catch{}
  run.child.stdout?.destroy();run.child.stderr?.destroy();run.child.unref();
}
async function isolated(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-job-test-'));
  const taskId='realjob-'+crypto.randomUUID().slice(0,8);
  const processes=[];
  t.after(async()=>{
    for(const p of processes)dispose(p);
    await fs.rm(root,{recursive:true,force:true}).catch(()=>{});
  });
  const track=p=>{processes.push(p);return p};
  return {root,taskId,track};
}
async function startAuto(ctx,hash){
  return ctx.track(executable(process.execPath,[
    supervisorScript,ctx.root,ctx.taskId,native,hash,'100000']));
}
async function armed(run){
  return waitUntil(async()=>{
    const found=run.events.find(e=>e.status==='ARMED');
    if(found)return found;
    if(run.child.exitCode!==null)throw Error('SUPERVISOR_EXITED_BEFORE_ARM:'+JSON.stringify(run.events));
    return null;
  },9000,'AUTO_ARMED');
}
async function stopOwner(run){
  assert.equal(run.child.kill('SIGKILL'),true,'owner SIGKILL not accepted');
  const result=await bounded(run.ended,6500);
  assert.equal(result.timeout,undefined,'owner did not terminate');
}
async function synthetic(ctx){
  const p=ctx.track(executable(native,['run',ctx.taskId,process.execPath,
    syntheticFixture,ctx.root,'prepared','8000','60000']));
  const ready=await waitUntil(async()=>receipt(path.join(ctx.root,'synthetic-prepared-ready.json')),
    12000,'SYNTHETIC_PREPARED');
  const live=await waitUntil(async()=>{
    const s=await receipt(path.join(ctx.root,'job-host-status.json'));
    return s?.status==='RUNNING'?s:null;
  },8000,'NATIVE_OWNER');
  await fs.writeFile(path.join(ctx.root,'real-readonly-ready.json'),
    JSON.stringify({taskId:ctx.taskId,threadId:ready.threadId,readOnly:true,
      baselineCompleted:true,guardianStarted:false,noFilesystemEffect:true}));
  await fs.writeFile(path.join(ctx.root,'real-readonly-turn-started.json'),
    JSON.stringify({taskId:ctx.taskId,threadId:ready.threadId,pid:29491,turnStarted:true}));
  return {p,ready,live};
}
const win=t=>{
  if(process.platform!=='win32'||!native){t.skip('Windows native test executable required');return false;}
  return true;
};

test('automatic observer never consumes a budget for IN_FLIGHT and duplicate observers cannot overwrite owner',{timeout:35000},async t=>{
  if(!win(t))return;
  const c=await isolated(t);
  const old=await synthetic(c);
  await beginExternalOperation(path.join(c.root,'state'),{
    taskId:c.taskId,operationId:'local_effect_001',epoch:0
  });
  const hash=await sha(native);
  const a=await startAuto(c,hash);
  assert.equal((await armed(a)).canResume,false);
  const duplicate=await startAuto(c,hash);
  const denied=await bounded(duplicate.ended,8000);
  assert.equal(denied.timeout,undefined);
  assert.notEqual(denied.code,0);
  assert.equal(duplicate.events.at(-1)?.reason,'SUPERVISOR_ALREADY_CLAIMED');
  assert.equal(await available(path.join(c.root,'experimental-auto-supervisor-result.json')),false);
  await stopOwner(old.p);
  const result=await waitUntil(()=>receipt(path.join(c.root,'experimental-auto-supervisor-result.json')),
    12000,'UNSAFE_STOP');
  assert.equal(result.status,'STOP');
  assert.equal(result.reason,'RECONCILIATION_REQUIRED');
  assert.equal(result.budgetConsumed,false);
  assert.equal(result.launchAttempted,false);
  const notice=await file(path.join(c.root,'stop-notice-e0001.json'));
  assert.equal(notice.reason,'RECONCILIATION_REQUIRED');
  assert.equal(notice.status,'STOP');
  assert.equal((await inspectRecoveryBudget(c.root,c.taskId)).used,0);
  assert.equal(await available(path.join(c.root,'native-epoch-001.json')),false);
  assert.equal((await bounded(a.ended,5000)).code,24);
});
test('owner STOP blocks autonomous launch before any epoch-1 claim',{timeout:30000},async t=>{
  if(!win(t))return;
  const c=await isolated(t);
  await synthetic(c);
  const a=await startAuto(c,await sha(native));
  assert.equal((await armed(a)).status,'ARMED');
  await fs.writeFile(path.join(c.root,'owner','owner-stop.json'),'{}');
  const result=await waitUntil(()=>receipt(path.join(c.root,'experimental-auto-supervisor-result.json')),
    10000,'OWNER_STOP');
  assert.equal(result.status,'STOP');
  assert.equal(result.reason,'OWNER_STOP');
  assert.equal(result.budgetConsumed,false);
  const notice=await file(path.join(c.root,'stop-notice-e0001.json'));
  assert.equal(notice.reason,'OWNER_STOP');
  assert.equal(notice.status,'STOP');
  assert.equal((await inspectRecoveryBudget(c.root,c.taskId)).used,0);
  assert.equal(await available(path.join(c.root,'native-epoch-001.json')),false);
});
test('after e0 owner SIGKILL, unattended observer launches exactly one native epoch-1 with same real Codex UUID',{timeout:175000},async t=>{
  if(!win(t))return;
  if(!cli){t.skip('Actual Codex CLI deliberately absent in hosted CI');return;}
  const c=await isolated(t);
  const hash=await sha(native);
  const binding={exe:cli,sha256:await sha(cli)};
  await fs.writeFile(path.join(c.root,'real-codex-binding.json'),JSON.stringify(binding));
  const e0=c.track(executable(native,['run',c.taskId,process.execPath,
    realFixture,c.root,'real-readonly','8000','120000']));
  const turn=await waitUntil(()=>receipt(path.join(c.root,'real-readonly-turn-started.json')),
    85000,'REAL_CODEX_SECOND_TURN');
  const ready=await file(path.join(c.root,'real-readonly-ready.json'));
  assert.equal(ready.taskId,c.taskId);
  assert.equal(ready.threadId,turn.threadId);
  assert.equal(ready.baselineCompleted,true);
  const auto=await startAuto(c,hash);
  assert.equal((await armed(auto)).status,'ARMED');
  // There is NO manual invocation of claimRecoveryAttempt or native e1 here.
  // The supervisor observes the old named Job and drives epoch1 itself.
  await stopOwner(e0);
  const final=await waitUntil(async()=>{
    const r=await receipt(path.join(c.root,'experimental-auto-supervisor-result.json'));
    if(r)return r;
    if(auto.child.exitCode!==null)throw Error('AUTO_EXITED_WITHOUT_RESULT:'+JSON.stringify(auto.events));
    return null;
  },105000,'AUTO_REAL_CODEX');
  assert.deepEqual({
    status:final.status,stage:final.stage,budgetConsumed:final.budgetConsumed,
    oldJobGone:final.oldJobGone,exactSessionResumed:final.exactSessionResumed,
    newNativeJobCompleted:final.newNativeJobCompleted
  },{
    status:'PASS',stage:'AUTONOMOUS_E1_VERIFIED',budgetConsumed:true,
    oldJobGone:true,exactSessionResumed:true,newNativeJobCompleted:true
  });
  assert.equal(final.productionRecoveryEnabled,false);
  assert.equal(await available(path.join(c.root,'stop-notice-e0001.json')),false);
  assert.equal((await bounded(auto.ended,6000)).code,0);
  assert.equal((await inspectRecoveryBudget(c.root,c.taskId)).used,1);
  const detail=await file(path.join(c.root,'native-e1-readonly-result.json'));
  assert.equal(detail.resumeSameThread,true);
  assert.equal(detail.nativeOwned,true);
  assert.equal(await available(path.join(c.root,'state','effect-once.txt')),false);
});
