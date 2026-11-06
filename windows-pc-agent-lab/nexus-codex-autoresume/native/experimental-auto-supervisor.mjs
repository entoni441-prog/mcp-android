// EXPERIMENTAL, one-session, fail-closed autonomous crash detector.
// Runs only in a brand-new disposable Win32 test root. It is intentionally
// NOT installed as a service, Scheduler task or production Guardian.
// The exact epoch-1 native owner is the ONLY process that starts the resumed
// read-only Codex CLI; this supervisor does not run Codex directly.
// Unknown IN_FLIGHT and unverified effects always STOP without budget spend.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {inspectRecoveryAdmissionWithKernel} from '../recovery-admission.mjs';
import {observeKernelJob} from '../kernel-job-observation.mjs';
import {inspectRecoveryBudget,claimRecoveryAttempt} from '../recovery-budget.mjs';
import {queueStopNotice} from '../stop-outbox.mjs';

const [root,taskId,nativeExe,expectedSha256,limitArg]=process.argv.slice(2);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const stop=reason=>Object.freeze({status:'STOP',reason,canResume:false});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const exists=async file=>fs.access(file).then(()=>true,()=>false);
const resultFile=typeof root==='string'?path.join(root,'experimental-auto-supervisor-result.json'):null;
const admissible=process.platform==='win32' && process.argv.length===7 &&
  typeof root==='string'&&path.isAbsolute(root) &&
  path.basename(root).startsWith('nexus-job-test-')&&
  path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep) &&
  typeof taskId==='string'&&/^realjob-[0-9a-f]{8}$/.test(taskId)&&
  typeof nativeExe==='string'&&path.isAbsolute(nativeExe)&&
  path.extname(nativeExe).toLowerCase()==='.exe'&&
  path.basename(nativeExe).toLowerCase().startsWith('nexus-guardian-')&&
  typeof expectedSha256==='string'&&/^[a-f0-9]{64}$/.test(expectedSha256)&&
  Number.isSafeInteger(Number(limitArg))&&Number(limitArg)>=5000&&Number(limitArg)<=110000;
if(!admissible)process.exit(64);

// Use fileURLToPath on Windows: URL path may begin /C:/.
const {fileURLToPath}=await import('node:url');
const childScript=path.join(path.dirname(fileURLToPath(import.meta.url)),
  'real-readonly-resume-fixture.mjs');
const waitUntil=Date.now()+Number(limitArg);
let stage='INITIALIZE',child=null,budgetConsumed=false,launchAttempted=false,ownsClaim=false;
let output=null;
const writeResult=async value=>{
  const h=await fs.open(resultFile,'wx',0o600);
  try{await h.writeFile(JSON.stringify(value)+'\n');await h.sync();}finally{await h.close();}
};
const read=async file=>{
  const st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>4096)throw Error('UNSAFE_TEST_RECEIPT');
  return JSON.parse(await fs.readFile(file,'utf8'));
};
async function waitNativeExit(p,ms){
  let timer;
  const result=await Promise.race([
    new Promise(resolve=>{
      p.once('exit',(code,signal)=>resolve({code,signal}));
      p.once('error',e=>resolve({error:e.code||'SPAWN_FAILED'}));
    }),
    new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),ms);})
  ]);
  clearTimeout(timer);
  return result;
}
try{
  const st=await fs.lstat(nativeExe);
  if(!st.isFile()||st.isSymbolicLink()||st.size<10000||st.size>5_000_000||
     (await sha(nativeExe))!==expectedSha256)throw Error('NATIVE_BINARY_UNTRUSTED');
  if(await exists(resultFile))throw Error('DUPLICATE_SUPERVISOR_RESULT');
  // An immutable supervisor-claim fences competing observers. If this
  // supervisor is killed, a successor must STOP instead of assuming a safe
  // restart from an ambiguous half-completed observation.
  const lease=await fs.open(path.join(root,'experimental-supervisor-claim.json'),'wx',0o600);
  try{
    await lease.writeFile(JSON.stringify({version:1,taskId,mode:'test-readonly-e1'})+'\n');
    await lease.sync();
  }finally{await lease.close();}
  ownsClaim=true;
  if(await exists(path.join(root,'native-epoch-001.json'))||
     await exists(path.join(root,'native-epoch-001-shadow.json')))throw Error('E1_ALREADY_CLAIMED');
  const ready=await read(path.join(root,'real-readonly-ready.json'));
  const turn=await read(path.join(root,'real-readonly-turn-started.json'));
  if(ready.taskId!==taskId||turn.taskId!==taskId||!UUID.test(ready.threadId)||
     ready.threadId!==turn.threadId||ready.baselineCompleted!==true||
     ready.readOnly!==true||ready.noFilesystemEffect!==true||
     turn.turnStarted!==true||!Number.isSafeInteger(turn.pid)||turn.pid<=0)
    throw Error('EXACT_READONLY_SESSION_UNVERIFIED');
  const budget=await inspectRecoveryBudget(root,taskId);
  if(budget.decision!=='READY'||budget.used!==0||budget.nextEpoch!==1)
    throw Error('INITIAL_BUDGET_INVALID');
  // IMPORTANT: arm only after OBSERVING THE LIVE OLD JOB. A supervisor that
  // begins after a crash has no proof that an old Job ever existed.
  stage='ARM_LIVE_KERNEL_JOB';
  const initial=await observeKernelJob({root,taskId,nativeExe,expectedSha256});
  if(initial.decision!=='STOP'||initial.reason!=='JOB_OBJECT_STILL_PRESENT'||
     !Number.isSafeInteger(initial.active)||initial.active<1)
    throw Error('LIVE_OLD_KERNEL_JOB_NOT_OBSERVED');
  process.stdout.write(JSON.stringify({status:'ARMED',taskId,canResume:false})+'\n');

  stage='AWAIT_OLD_KERNEL_TERMINATION';
  while(Date.now()<waitUntil){
    if(await exists(path.join(root,'owner','owner-stop.json'))||
       await exists(path.join(root,'owner','host-off')))
      throw Error('OWNER_STOP');
    const old=await observeKernelJob({root,taskId,nativeExe,expectedSha256});
    if(old.decision==='OS_OBSERVATION_ONLY'&&old.canResume===false)break;
    if(old.reason!=='JOB_OBJECT_STILL_PRESENT')throw Error('OS_PROOF_UNCERTAIN');
    await wait(70);
  }
  if(Date.now()>=waitUntil)throw Error('OLD_JOB_STILL_ACTIVE_OR_TIMEOUT');

  // Passive gate NEVER grants execution authorization. In this single
  // synthetic read-only scenario, an OS-proven PREPARED operation is the
  // sole permitted input for the separate owner-controlled test mode.
  stage='CHECK_JOURNAL_AND_OS_ADMISSION';
  const gate=await inspectRecoveryAdmissionWithKernel({
    root,taskId,threadId:ready.threadId,operationId:'local_effect_001',
    nativeExe,expectedSha256
  });
  if(gate.decision!=='REQUIRES_ATTESTATION'||
     gate.operationStage!=='PREPARED'||
     gate.kernelJobObservedMissing!==true||gate.canResume!==false)
    throw Error(gate.reason||'ADMISSION_NOT_PROVEN');
  if(await exists(path.join(root,'state','effect-once.txt'))||
     await exists(path.join(root,'state','complete.json')))
    throw Error('EXTERNAL_EFFECT_UNCERTAIN');

  stage='CONSUME_EXACT_BUDGET_ATTEMPT';
  const claim=await claimRecoveryAttempt(root,taskId,1);
  if(claim.decision!=='CLAIMED'||claim.attempt!==1||claim.remaining!==4)
    throw Error(claim.reason||'BUDGET_CLAIM_FAILED');
  budgetConsumed=true;
  // No second claim is ever issued in this process. A crash between here
  // and native launch is FAIL CLOSED: restart must not refund the attempt.
  if(await exists(path.join(root,'owner','owner-stop.json'))||
     await exists(path.join(root,'owner','host-off')))
    throw Error('OWNER_STOP_AFTER_BUDGET');
  if((await sha(nativeExe))!==expectedSha256)throw Error('NATIVE_BINARY_CHANGED');
  if(await exists(path.join(root,'native-epoch-001.json')))
    throw Error('E1_ALREADY_CLAIMED');

  stage='START_NATIVE_EPOCH1_EXACTLY_ONCE';
  launchAttempted=true;
  child=spawn(nativeExe,['run',taskId,process.execPath,childScript,root,
    'resume-readonly','8000','85000'],{
    cwd:path.dirname(childScript),windowsHide:true,stdio:['ignore','pipe','pipe']
  });
  // Draining child streams is essential: never wait for 'close' as the
  // readiness/termination witness; a descendant could inherit those handles.
  let stdout='',stderr='';
  child.stdout.on('data',d=>{stdout=(stdout+d.toString()).slice(-4096);});
  child.stderr.on('data',d=>{stderr=(stderr+d.toString()).slice(-1024);});
  const ended=await waitNativeExit(child,87000);
  if(ended.timeout||ended.error||ended.code!==0)
    throw Error('NATIVE_E1_DID_NOT_COMPLETE');
  stage='VERIFY_EXACT_EPOCH1_RESULT';
  const e1=await read(path.join(root,'native-epoch-001.json'));
  const receipt=await read(path.join(root,'native-e1-readonly-result.json'));
  const status=await read(path.join(root,'job-host-status.json'));
  const latest=await inspectRecoveryBudget(root,taskId);
  if(e1.epoch!==1||e1.taskId!==taskId||e1.restartCount!==1||
     receipt.status!=='PASS'||receipt.taskId!==taskId||
     receipt.epoch!==1||receipt.nativeOwned!==true||
     receipt.resumeSameThread!==true||receipt.turnCompleted!==true||
     receipt.externalEffectReplayed!==false||receipt.readOnly!==true||
     status.status!=='COMPLETED'||status.taskId!==taskId||status.jobActive!==0||
     latest.used!==1||latest.remaining!==4||
     await exists(path.join(root,'state','effect-once.txt')))
    throw Error('E1_DURABLE_RESULT_UNVERIFIED');
  output={status:'PASS',stage:'AUTONOMOUS_E1_VERIFIED',taskId,
    oldJobGone:true,preparedNoEffect:true,budgetConsumed:true,
    exactSessionResumed:true,newNativeJobCompleted:true,
    ownerUnattendedWithinTest:true,productionRecoveryEnabled:false};
}catch(e){
  const reason=(e.code==='EEXIST'&&!ownsClaim)
    ?'SUPERVISOR_ALREADY_CLAIMED'
    :String(e.message||'UNSPECIFIED').slice(0,64);
  output={...stop(reason),stage,taskId,budgetConsumed,launchAttempted,
    productionRecoveryEnabled:false};
  // This queues a durable local STOP only. No external notification transport
  // and no false claim of delivered alerts.
  if(ownsClaim)try{await queueStopNotice(root,{taskId,epoch:1,reason:
    reason==='OWNER_STOP'||reason==='OWNER_STOP_AFTER_BUDGET'?'OWNER_STOP':
    reason==='OLD_JOB_STILL_ACTIVE_OR_TIMEOUT'?'PRIOR_PROCESS_ALIVE':
    reason==='ADMISSION_NOT_PROVEN'||reason==='RECONCILIATION_REQUIRED'
      ?'RECONCILIATION_REQUIRED':
    'NATIVE_RECOVERY_UNSAFE'});}catch{}
}finally{
  if(child){
    if(output?.status!=='PASS')try{child.kill('SIGKILL');}catch{}
    child.stdout?.destroy();child.stderr?.destroy();child.unref();
  }
  if(ownsClaim)try{await writeResult(output);}catch{
    // An unrecorded outcome can NEVER be treated as a successful recovery.
    process.exitCode=40;
  }
  if(!process.exitCode)process.exitCode=output?.status==='PASS'?0:24;
  console.log(JSON.stringify(output));
}
