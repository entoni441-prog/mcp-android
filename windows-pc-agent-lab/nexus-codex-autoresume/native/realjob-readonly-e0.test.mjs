// MANUAL Windows experimental test. A real, NEW, read-only Codex session is
// created INSIDE a native Win32 Job; the native owner is SIGKILLed, and only
// after kernel Job disappearance, exact PID death, PREPARED journal and a
// durable budget claim is that same UUID independently resumed read-only.
// This is NOT the production Guardian recover command and never permits
// workspace writes. Existing Codex sessions/processes are never targeted.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectRecoveryAdmissionWithKernel} from '../recovery-admission.mjs';
import {observeKernelJob} from '../kernel-job-observation.mjs';
import {claimRecoveryAttempt,inspectRecoveryBudget} from '../recovery-budget.mjs';
import {getOperation} from '../operation-journal.mjs';

const [work,binary]=process.argv.slice(2),native=process.env.NEXUS_JOBHOST_EXE;
const nativeEpoch1=process.env.NEXUS_TEST_NATIVE_EPOCH1==='1';
const allowed=process.platform==='win32'&&process.argv.length===4&&
  typeof work==='string'&&path.isAbsolute(work)&&(work.includes('nexus-guardian-realjob-readonly-20261106')||
   work.includes('nexus-guardian-native-epoch1-readonly-20261106'))&&
  typeof binary==='string'&&path.isAbsolute(binary)&&path.basename(binary).toLowerCase()==='codex.exe'&&
  typeof native==='string'&&path.isAbsolute(native)&&path.extname(native).toLowerCase()==='.exe';
if(!allowed)process.exit(64);
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-job-test-'));
const task='realjob-'+crypto.randomUUID().slice(0,8);
const here=path.dirname(fileURLToPath(import.meta.url));
const fixture=path.join(here,'real-readonly-fixture.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sha=async p=>crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex');
const timeout=async(p,ms)=>{
  let handle;
  try{return await Promise.race([p,new Promise(resolve=>{
    handle=setTimeout(()=>resolve({timeout:true}),ms);
  })]);}finally{clearTimeout(handle);}
};
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const waitGone=async(pid,ms=7000)=>{
  const until=Date.now()+ms;while(Date.now()<until){if(!alive(pid))return true;await sleep(50);}
  return !alive(pid);
};
async function read(file){return JSON.parse(await fs.readFile(file,'utf8'));}
async function untilFile(file,ms=60000){
  const end=Date.now()+ms;
  while(Date.now()<end){
    try{return await read(file);}catch{}
    try{
      const e=await read(path.join(temp,'real-job-error.json'));
      throw Error('FIXTURE_'+e.reason);
    }catch(e){if(e.message?.startsWith('FIXTURE_'))throw e;}
    await sleep(50);
  }
  throw Error('RECEIPT_TIMEOUT_'+path.basename(file));
}
const nativeHash=await sha(native);
const codexHash=await sha(binary);
await fs.writeFile(path.join(temp,'real-codex-binding.json'),
  JSON.stringify({exe:binary,sha256:codexHash}));
let owner,second,thread=null,stage='START',record={},cleanup=false;
function start(exe,args,cwd){
  const p=spawn(exe,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='',events=[];
  p.stdout.on('data',d=>{
    out+=d.toString();
    if(out.length>120000){p.kill('SIGKILL');return;}
    while(out.includes('\n')){
      const i=out.indexOf('\n');let line=out.slice(0,i);out=out.slice(i+1);
      let v;try{v=JSON.parse(line);}catch{continue;}
      events.push(v);
    }
  });
  p.stderr.on('data',d=>{err=(err+d.toString()).slice(-1000);});
  const ended=new Promise(resolve=>{
    p.once('exit',(code,signal)=>resolve({code,signal}));
    p.once('error',e=>resolve({error:e.code||'SPAWN_ERROR'}));
  });
  return {p,ended,events,get err(){return err;}};
}
try{
  stage='NATIVE_OWNER_START';
  owner=start(native,['run',task,process.execPath,fixture,temp,'real-readonly','8000','120000'],here);
  // The fixture must confirm a saved baseline and that a second real Codex
  // turn has started. No recovery is attempted before that evidence exists.
  stage='WAIT_SECOND_TURN';
  const turn=await untilFile(path.join(temp,'real-readonly-turn-started.json'),85000);
  const ready=await read(path.join(temp,'real-readonly-ready.json'));
  const job=await read(path.join(temp,'job-host-status.json'));
  assertCondition(ready.baselineCompleted===true&&ready.readOnly===true&&
    ready.noFilesystemEffect===true&&turn.taskId===task&&
    turn.threadId===ready.threadId&&turn.turnStarted===true&&
    job.status==='RUNNING'&&job.ownerPid===owner.p.pid,'LIVE_JOB_SCOPE_UNVERIFIED');
  thread=ready.threadId;
  stage='INJECT_NATIVE_SIGKILL';
  owner.p.kill('SIGKILL');
  const killed=await timeout(owner.ended,7000);
  assertCondition(!killed.timeout&&!killed.error,'NATIVE_OWNER_DEATH_UNVERIFIED');
  owner.p.stdout.destroy();owner.p.stderr.destroy();owner.p.unref();
  assertCondition(await waitGone(job.childPid),'JOB_OWNED_NODE_STILL_ALIVE');
  assertCondition(await waitGone(turn.pid),'JOB_OWNED_CODEX_STILL_ALIVE');
  let os;
  for(let i=0;i<120;i++){
    os=await observeKernelJob({root:temp,taskId:task,nativeExe:native,expectedSha256:nativeHash});
    if(os.decision==='OS_OBSERVATION_ONLY')break;
    await sleep(50);
  }
  assertCondition(os?.decision==='OS_OBSERVATION_ONLY','KERNEL_JOB_NOT_GONE');
  stage='JOURNAL_AND_BUDGET_CHECK';
  const entry=await getOperation(path.join(temp,'state'),{
    taskId:task,operationId:'local_effect_001',epoch:0
  });
  assertCondition(entry.stage==='PREPARED','JOURNAL_UNSAFE_'+entry.stage);
  const gate=await inspectRecoveryAdmissionWithKernel({
    root:temp,taskId:task,threadId:thread,operationId:'local_effect_001',
    nativeExe:native,expectedSha256:nativeHash
  });
  assertCondition(gate.decision==='REQUIRES_ATTESTATION'&&
    gate.operationStage==='PREPARED'&&gate.kernelJobObservedMissing===true&&
    gate.canResume===false,'RECOVERY_GATE_BLOCKED');
  assertCondition((await inspectRecoveryBudget(temp,task)).used===0,'BUDGET_ALREADY_SPENT');
  const resumeScript=path.join(here,'real-readonly-resume-fixture.mjs');
  const epochOneArgs=['run',task,process.execPath,resumeScript,temp,
    'resume-readonly','8000','90000'];
  if(nativeEpoch1){
    // Cannot launch a new owner until an immutable budget receipt is present.
    stage='E1_REQUIRES_PRESPENT_BUDGET';
    const premature=start(native,epochOneArgs,here);
    const denied=await timeout(premature.ended,11000);
    premature.p.stdout.destroy();premature.p.stderr.destroy();premature.p.unref();
    assertCondition(!denied.timeout&&!denied.error&&denied.code!==0,
      'E1_EARLY_LAUNCH_NOT_REJECTED');
    assertCondition(await fs.access(path.join(temp,'native-epoch-001.json')).then(()=>false,()=>true),
      'E1_EARLY_CLAIM');
  }
  const spent=await claimRecoveryAttempt(temp,task,1);
  assertCondition(spent.decision==='CLAIMED'&&spent.remaining===4,'DURABLE_FENCE_FAILED');
  assertCondition((await claimRecoveryAttempt(temp,task,1)).decision==='STOP','DUPLICATE_FENCE_ALLOWED');
  let same=false,completed=false,marker=false;
  if(nativeEpoch1){
    stage='NATIVE_EPOCH1_OWNED_RESUME';
    assertCondition((await sha(binary))===codexHash,'CODEX_BINARY_CHANGED');
    second=start(native,epochOneArgs,here);
    const outcome=await timeout(second.ended,82000);
    assertCondition(!outcome.timeout&&!outcome.error&&outcome.code===0,
      'E1_NATIVE_RUN_FAILED');
    const e1=await read(path.join(temp,'native-epoch-001.json'));
    const assigned=await fs.readFile(path.join(temp,'native-job-assigned-e1.txt'),'utf8');
    const owned=await read(path.join(temp,'native-e1-readonly-result.json'));
    const host=await read(path.join(temp,'job-host-status.json'));
    assertCondition(e1.epoch===1&&e1.restartCount===1&&e1.taskId===task,
      'E1_EPOCH_RECEIPT_INVALID');
    assertCondition(assigned.includes('jobAssigned=1')&&
      assigned.includes('inheritedHandles=0')&&assigned.includes('breakaway=0'),
      'E1_JOB_ASSIGNMENT_UNVERIFIED');
    assertCondition(host.status==='COMPLETED'&&host.jobActive===0&&
      host.taskId===task,'E1_JOB_NOT_EMPTY');
    assertCondition(owned.status==='PASS'&&owned.nativeOwned===true&&
      owned.epoch===1&&owned.taskId===task&&owned.readOnly===true&&
      owned.externalEffectReplayed===false,'E1_READONLY_RESULT_UNVERIFIED');
    same=owned.resumeSameThread===true;
    completed=owned.turnCompleted===true;
    marker=owned.status==='PASS';
    const repeat=start(native,epochOneArgs,here);
    const denied=await timeout(repeat.ended,11000);
    repeat.p.stdout.destroy();repeat.p.stderr.destroy();repeat.p.unref();
    assertCondition(!denied.timeout&&!denied.error&&denied.code!==0,
      'E1_SECOND_OWNER_ALLOWED');
  }else{
  stage='INDEPENDENT_TEST_ONLY_READONLY_RESUME';
  // Deliberately an independent read-only test, NOT native recover.
  // The production gate still says canResume:false and remains disabled.
  assertCondition((await sha(binary))===codexHash,'CODEX_BINARY_CHANGED');
  second=start(binary,['exec','resume','--json','-c','sandbox_mode="read-only"',
    thread,'This is a test-only read-only diagnostic after native Job owner death. Do not use tools and do not change files. Reply exactly NEXUS-REALJOB-READONLY-RECOVERED.'],
    path.join(temp,'repo'));
  const result=await timeout(second.ended,60000);
  assertCondition(!result.timeout&&!result.error,'CODEX_RESUME_EXIT_UNVERIFIED');
  await sleep(200);
    same=second.events.some(e=>e.type==='thread.started'&&e.thread_id===thread);
    completed=second.events.some(e=>e.type==='turn.completed');
    marker=second.events.some(e=>e.type==='item.completed'&&
      e.item?.type==='agent_message'&&e.item.text?.includes('NEXUS-REALJOB-READONLY-RECOVERED'));
  }
  assertCondition((await inspectRecoveryBudget(temp,task)).used===1,'BUDGET_NOT_PERSISTED');
  assertCondition(await fs.access(path.join(temp,'state','effect-once.txt')).then(()=>false,()=>true),
    'UNEXPECTED_FILE_EFFECT');
  record={status:'PASS',test:nativeEpoch1?'NATIVE_EPOCH1_REAL_CODEX':'REAL_CODEX_INSIDE_EPOCH0_JOB',
    baselineSaved:true,secondTurnInterrupted:true,kernelJobGone:true,
    ownedNodeDead:true,ownedCodexDead:true,journal:'PREPARED',
    budgetAttempt:1,duplicateClaimRejected:true,resumeSameUUID:true,
    resumeCompleted:true,nativeEpoch1Owned:nativeEpoch1,productionRecoveryEnabled:false};
  process.exitCode=0;
  cleanup=true;
}catch(e){
  record={status:'STOP',test:nativeEpoch1?'NATIVE_EPOCH1_REAL_CODEX':'REAL_CODEX_INSIDE_EPOCH0_JOB',phase:stage,
    reason:String(e.message||'UNSPECIFIED').slice(0,75),
    baselineSaved:!!thread,productionRecoveryEnabled:false};
  process.exitCode=2;
}finally{
  for(const p of [owner?.p,second?.p]){
    if(p){try{p.kill('SIGKILL');}catch{}p.stdout?.destroy();p.stderr?.destroy();p.unref();}
  }
  if(cleanup)await fs.rm(temp,{recursive:true,force:true}).catch(()=>{});
  console.log(JSON.stringify(record));
}
function assertCondition(condition,code){if(!condition)throw Error(code);}
