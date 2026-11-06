// Passive, fail-closed recovery readiness inspection. NOT an executor.
// File receipts are untrusted attestations: only a living native Job owner
// holding exact OS handles may grant admission. This module NEVER says ELIGIBLE.
import fs from 'node:fs/promises';
import path from 'node:path';
import {inspectRecoveryBudget} from './recovery-budget.mjs';
import {getOperation} from './operation-journal.mjs';
import {observeKernelJob} from './kernel-job-observation.mjs';

const id=/^[A-Za-z0-9_-]{1,64}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stop=reason=>Object.freeze({decision:'STOP',reason});
async function load(file,cap=2048){
  try{
    const stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>cap)throw Error('BAD_FILE');
    return JSON.parse(await fs.readFile(file,'utf8'));
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
const keys=(obj,expected)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).length===expected.length&&expected.every(k=>Object.hasOwn(obj,k));
const natkeys=['taskId','epoch','restartCount','ownerPid','ownerStartTicks'];
export async function inspectRecoveryAdmission({root,taskId,threadId,operationId}={}){
  if(typeof root!=='string'||!path.isAbsolute(root)||
     typeof taskId!=='string'||!id.test(taskId)||
     typeof threadId!=='string'||!uuid.test(threadId)||
     typeof operationId!=='string'||!id.test(operationId))return stop('INVALID_IDENTITY');
  const stateDir=path.join(root,'state');
  try{
    // Owner stop is an absolute block; no external ledger can waive it.
    if(await fs.access(path.join(root,'owner','owner-stop.json')).then(()=>true,()=>false)||
       await fs.access(path.join(root,'owner','host-off')).then(()=>true,()=>false))
      return stop('OWNER_STOP');
    const budget=await inspectRecoveryBudget(root,taskId);
    if(budget.decision!=='READY')return stop(budget.reason||'BUDGET_UNVERIFIED');
    if(budget.used!==0||budget.nextEpoch!==1)return stop('PRIOR_RECOVERY_ALREADY_CLAIMED');
    const epochPath=path.join(root,'native-epoch-000.json');
    const epoch=await load(epochPath);
    // Windows DateTime.Ticks exceeds JavaScript's safe integer range.
    // Compare the original *decimal bytes*, never a rounded JSON number.
    const epochText=await fs.readFile(epochPath,'utf8');
    const tickMatch=epochText.match(/"ownerStartTicks":([1-9][0-9]{15,})/);
    if(!keys(epoch,natkeys)||epoch.taskId!==taskId||epoch.epoch!==0||
       epoch.restartCount!==0||!Number.isSafeInteger(epoch.ownerPid)||epoch.ownerPid<=0||
       !tickMatch)return stop('NATIVE_EPOCH_UNVERIFIED');
    const assignmentFile=path.join(root,'native-job-assigned-e0.txt');
    const stat=await fs.lstat(assignmentFile);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024)
      return stop('JOB_ASSIGNMENT_UNVERIFIED');
    const assignment=await fs.readFile(assignmentFile,'utf8');
    const fields=assignment.trimEnd().split(/\r?\n/);
    const expected=['taskId='+taskId,'ownerPid='+epoch.ownerPid,
      'ownerStartTicks='+tickMatch[1]];
    if(fields.length!==8||expected.some((x,i)=>fields[i]!==x)||
       !/^childPid=[1-9]\d*$/.test(fields[3])||
       !/^childStartTicks=[1-9]\d*$/.test(fields[4])||
       fields[5]!=='jobAssigned=1'||fields[6]!=='inheritedHandles=0'||
       fields[7]!=='breakaway=0')return stop('JOB_ASSIGNMENT_UNVERIFIED');
    const state=await load(path.join(stateDir,'state.json'),8192);
    if(!state||state.taskId!==taskId||state.threadId!==threadId||
       !['RUNNING','RECOVERING','STOP'].includes(state.status))
      return stop('SESSION_UNVERIFIED');
    const completion=await load(path.join(stateDir,'complete.json'));
    if(completion){
      if(keys(completion,['taskId','status'])&&
         completion.taskId===taskId&&completion.status==='completed')
        return Object.freeze({decision:'TASK_MARKED_COMPLETED',reason:'REQUIRES_INDEPENDENT_COMPLETION_VALIDATION'});
      return stop('COMPLETION_UNVERIFIED');
    }
    // No receipt for the effect => no safe automatic continuation.
    const op=await getOperation(stateDir,{taskId,operationId,epoch:0});
    if(op.stage==='IN_FLIGHT')return stop('RECONCILIATION_REQUIRED');
    if(op.stage==='UNREGISTERED')return stop('OPERATION_NOT_REGISTERED');
    if(op.stage==='COMMITTED'){
      // A local COMMITTED row does not authenticate the external provider.
      return Object.freeze({decision:'REQUIRES_ATTESTATION',
        reason:'EXTERNAL_RECEIPT_AND_LIVE_OS_JOB_PROOF_REQUIRED',
        previousEpoch:0,nextEpoch:1,operationStage:'COMMITTED'});
    }
    if(op.stage==='PREPARED'){
      return Object.freeze({decision:'REQUIRES_ATTESTATION',
        reason:'LIVE_OS_JOB_PROOF_REQUIRED',
        previousEpoch:0,nextEpoch:1,operationStage:'PREPARED'});
    }
    return stop('OPERATION_STATE_UNVERIFIED');
  }catch{return stop('RECOVERY_EVIDENCE_UNREADABLE');}
}


// Combined read-only review. OS observation is obtained by executing an
// independently SHA-pinned native probe, not supplied as untrusted JSON flags.
// STILL NOT an executor: no recovery epoch is spent, no Codex is launched.
export async function inspectRecoveryAdmissionWithKernel(args={}){
  const fileGate=await inspectRecoveryAdmission(args);
  // A blocked journal/owner must NEVER be overridden by a healthy Job probe.
  if(fileGate.decision!=='REQUIRES_ATTESTATION')return fileGate;
  const os=await observeKernelJob({
    root:args.root,taskId:args.taskId,
    nativeExe:args.nativeExe,expectedSha256:args.expectedSha256
  });
  if(os.decision!=='OS_OBSERVATION_ONLY')
    return stop(os.reason||'KERNEL_JOB_NOT_VERIFIED');
  // Even a verified same-session named Job absence cannot independently
  // establish the external side-effect state or trusted authorization.
  return Object.freeze({
    decision:'REQUIRES_ATTESTATION',
    reason:fileGate.operationStage==='COMMITTED'
      ?'PROVIDER_RECONCILIATION_AND_OWNER_AUTHORIZATION_REQUIRED'
      :'OWNER_AUTHORIZATION_AND_FENCE_REQUIRED',
    previousEpoch:fileGate.previousEpoch,
    nextEpoch:fileGate.nextEpoch,
    operationStage:fileGate.operationStage,
    kernelJobObservedMissing:true,
    canResume:false
  });
}
