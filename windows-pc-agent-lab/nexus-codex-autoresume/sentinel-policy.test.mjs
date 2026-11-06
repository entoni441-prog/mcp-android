import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRecovery} from './sentinel-policy.mjs';

const baseline=()=>({
  manifestApproved:true,ownerStop:false,
  guardianExitObserved:true,guardianIdentityVerified:true,
  claimsMatch:true,gitClean:true,branchMatches:true,binaryHashMatches:true,
  guardianGone:true,controllerGone:true,cliGone:true,
  rescueClaimExists:false,guardianResumeClaimExists:false,
  taskId:'test-id',stateTaskId:'test-id',completionMarkerValid:false,
  stateStatus:'RUNNING',attempt:0,recordedStatus:null,
  threadId:'019a8f9b-1452-71c0-8a17-6915a0904d67',
  controllerPid:12345,cliPid:12346
});
test('verified case authorizes only a single fenced exact-thread resume',()=>{
  assert.deepEqual(assessRecovery(baseline()),{
    decision:'ELIGIBLE_FOR_SINGLE_RESUME',reason:'EXACT_THREAD_WITH_FENCE_REQUIRED',attempt:1
  });
});
test('confirmed completion avoids any resume',()=>{
  const e=baseline();e.completionMarkerValid=true;
  assert.deepEqual(assessRecovery(e),{decision:'COMPLETE',reason:'COMPLETION_MARKER',attempt:0});
});
const prohibitions=[
  ['no evidence',null,'EVIDENCE_MISSING'],
  ['no explicit authorization',{manifestApproved:false},'NOT_APPROVED'],
  ['missing owner signal',{ownerStop:undefined},'OWNER_STOP_OR_UNKNOWN'],
  ['owner stop',{ownerStop:true},'OWNER_STOP_OR_UNKNOWN'],
  ['guardian exit unverified',{guardianExitObserved:false},'GUARDIAN_DEATH_UNPROVEN'],
  ['guardian identity unknown',{guardianIdentityVerified:false},'GUARDIAN_DEATH_UNPROVEN'],
  ['different claim',{claimsMatch:false},'CLAIMS_UNVERIFIED'],
  ['dirty git',{gitClean:false},'ENVIRONMENT_UNVERIFIED'],
  ['wrong branch',{branchMatches:false},'ENVIRONMENT_UNVERIFIED'],
  ['binary hash mismatch',{binaryHashMatches:false},'ENVIRONMENT_UNVERIFIED'],
  ['guardian alive',{guardianGone:false},'PROCESS_STILL_ALIVE_OR_UNKNOWN'],
  ['controller alive',{controllerGone:false},'PROCESS_STILL_ALIVE_OR_UNKNOWN'],
  ['CLI alive',{cliGone:false},'PROCESS_STILL_ALIVE_OR_UNKNOWN'],
  ['PID state unknown',{cliGone:undefined},'PROCESS_STILL_ALIVE_OR_UNKNOWN'],
  ['one rescue already claimed',{rescueClaimExists:true},'RECOVERY_ALREADY_CLAIMED'],
  ['prior guardian resume already armed',{guardianResumeClaimExists:true},'RECOVERY_ALREADY_CLAIMED'],
  ['bad task identity',{stateTaskId:'some-other-task'},'TASK_MISMATCH'],
  ['unknown completion marker',{completionMarkerValid:undefined},'MARKER_UNVERIFIED'],
  ['state recovering',{stateStatus:'RECOVERING'},'STATE_NOT_RECOVERABLE'],
  ['state terminal',{stateStatus:'STOP'},'STATE_NOT_RECOVERABLE'],
  ['prior attempt',{attempt:1},'STATE_NOT_RECOVERABLE'],
  ['completed turn without marker',{recordedStatus:'turn.completed'},'STATE_NOT_RECOVERABLE'],
  ['missing thread',{threadId:null},'THREAD_UNVERIFIED'],
  ['malformed thread',{threadId:'last'},'THREAD_UNVERIFIED'],
  ['missing PID',{cliPid:null},'PID_UNVERIFIED'],
  ['PID collision',{cliPid:12345},'PID_COLLISION']
];
for(const [title,override,reason] of prohibitions){
  test('STOP: '+title,()=>{
    const result=assessRecovery(override===null?null:{...baseline(),...override});
    assert.deepEqual(result,{decision:'STOP',reason});
  });
}
test('terminal STOP cannot be overridden by marker',()=>{
  const evidence=baseline();evidence.completionMarkerValid=true;evidence.stateStatus='STOP';
  assert.deepEqual(assessRecovery(evidence),{decision:'STOP',reason:'PRIOR_TERMINAL_STOP'});
});
test('reject untrusted evidence mutation after result creation',()=>{
  const e=baseline(),result=assessRecovery(e);e.threadId='not-a-thread';
  assert.equal(result.decision,'ELIGIBLE_FOR_SINGLE_RESUME');
  assert.equal(Object.isFrozen(result),true);
});
