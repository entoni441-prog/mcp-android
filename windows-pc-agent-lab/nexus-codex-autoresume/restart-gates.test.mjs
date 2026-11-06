import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRestart} from './restart-gates.mjs';
const ok=()=>({
  ownerApproved:true,ownerStop:false,
  schedulerSingleInstance:true,osMutexOwned:true,
  taskMatches:true,exclusiveClaimsMatch:true,
  codeHashMatches:true,branchMatches:true,worktreeClean:true,
  epoch:2,previousEpoch:1,restartCount:1,restartBudgetDurable:true,
  bootMode:'normal',isGuiTask:false,rebootDetected:false,codexResumeAfterRebootProven:false,
  guardianKnownAlive:false,controllerKnownAlive:false,codexKnownAlive:false,
  heartbeatStale:true,priorGuardianExitVerified:true,
  jobAssignmentConfirmed:true,jobEmptyConfirmed:true,
  priorAttemptAlreadyResumed:false,exactSessionPersisted:true,
  completionReceiptValid:false,resumeBudgetRemaining:1,
  operation:{operationId:'once-01',epoch:1,state:'PREPARED',externalEffectMayHaveStarted:false}
});
test('a proven safe crash can authorize only a single fenced exact-thread resume',()=>{
  assert.deepEqual(assessRestart(ok()),{decision:'ELIGIBLE',reason:'ONE_EXACT_THREAD_RESUME_WITH_DURABLE_FENCE',epoch:2});
});
test('matching completion receipt avoids all resumed execution',()=>{
  assert.deepEqual(assessRestart({...ok(),completionReceiptValid:true}),{decision:'COMPLETE',reason:'RECEIPT_CONFIRMED'});
});
test('committed operation requires verified external receipt',()=>{
  const e=ok();e.operation={...e.operation,state:'COMMITTED',externalReceiptVerified:true};
  assert.deepEqual(assessRestart(e),{decision:'COMPLETE',reason:'OPERATION_COMMITTED'});
  e.operation.externalReceiptVerified=false;
  assert.equal(assessRestart(e).reason,'COMMIT_UNVERIFIED');
});
const rejects=[
  ['no evidence',null,'EVIDENCE_MISSING'],
  ['unapproved',{ownerApproved:false},'UNAPPROVED'],
  ['unknown STOP',{ownerStop:undefined},'OWNER_STOP_OR_UNKNOWN'],
  ['STOP active',{ownerStop:true},'OWNER_STOP_OR_UNKNOWN'],
  ['scheduler concurrent',{schedulerSingleInstance:false},'SINGLE_INSTANCE_UNPROVEN'],
  ['mutex not owned',{osMutexOwned:false},'SINGLE_INSTANCE_UNPROVEN'],
  ['wrong task',{taskMatches:false},'TASK_IDENTITY_UNPROVEN'],
  ['different claim',{exclusiveClaimsMatch:false},'TASK_IDENTITY_UNPROVEN'],
  ['binary changed',{codeHashMatches:false},'ENVIRONMENT_CHANGED'],
  ['branch changed',{branchMatches:false},'ENVIRONMENT_CHANGED'],
  ['dirty worktree',{worktreeClean:false},'ENVIRONMENT_CHANGED'],
  ['epoch repeated',{epoch:1},'EPOCH_INVALID'],
  ['epoch skipped',{epoch:3},'EPOCH_INVALID'],
  ['restart budget unverified',{restartBudgetDurable:false},'RESTART_BUDGET_UNVERIFIED'],
  ['restart overflow',{restartCount:6},'RESTART_BUDGET_EXHAUSTED'],
  ['unknown boot mode',{bootMode:'boot'},'BOOT_MODE_UNVERIFIED'],
  ['unknown reboot state',{rebootDetected:null},'REBOOT_STATE_UNVERIFIED'],
  ['GUI at startup',{isGuiTask:true,bootMode:'post-reboot'},'GUI_REQUIRES_LOGON'],
  ['CLI reboot unverified at logon',{bootMode:'logon',rebootDetected:true},'REBOOT_RESUME_UNPROVEN'],
  ['old guardian still alive',{guardianKnownAlive:true},'PRIOR_PROCESS_ALIVE'],
  ['old controller still alive',{controllerKnownAlive:true},'PRIOR_PROCESS_ALIVE'],
  ['old CLI still alive',{codexKnownAlive:true},'PRIOR_PROCESS_ALIVE'],
  ['heartbeat fresh',{heartbeatStale:false},'DEATH_UNVERIFIED'],
  ['heartbeat alone',{priorGuardianExitVerified:false},'DEATH_UNVERIFIED'],
  ['job assignment unknown',{jobAssignmentConfirmed:false},'PROCESS_TREE_UNVERIFIED'],
  ['job not empty',{jobEmptyConfirmed:false},'PROCESS_TREE_UNVERIFIED'],
  ['job empty unknown',{jobEmptyConfirmed:null},'PROCESS_TREE_UNVERIFIED'],
  ['previous resume claimed',{priorAttemptAlreadyResumed:true},'RECOVERY_ALREADY_CONSUMED'],
  ['session unknown',{exactSessionPersisted:false},'SESSION_UNVERIFIED'],
  ['receipt unknown',{completionReceiptValid:null},'RECEIPT_UNVERIFIED'],
  ['operation missing',{operation:null},'OPERATION_UNVERIFIED'],
  ['operation incorrect epoch',{operation:{operationId:'once-01',epoch:0,state:'PREPARED',externalEffectMayHaveStarted:false}},'OPERATION_EPOCH_MISMATCH'],
  ['effect boundary uncertain',{operation:{operationId:'once-01',epoch:1,state:'PREPARED',externalEffectMayHaveStarted:null}},'EFFECT_BOUNDARY_UNVERIFIED'],
  ['in flight irreversible',{operation:{operationId:'once-01',epoch:1,state:'IN_FLIGHT',externalEffectMayHaveStarted:true}},'RECONCILIATION_REQUIRED'],
  ['in flight with key still stops',{operation:{operationId:'once-01',epoch:1,state:'IN_FLIGHT',idempotencyKey:'same-key',externalEffectMayHaveStarted:true}},'RECONCILIATION_REQUIRED'],
  ['bad operation state',{operation:{operationId:'once-01',epoch:1,state:'UNKNOWN',externalEffectMayHaveStarted:false}},'OPERATION_STATE_UNVERIFIED'],
  ['resume exhausted',{resumeBudgetRemaining:0},'RESUME_BUDGET_UNVERIFIED']
];
for(const [name,over,reason] of rejects) test('STOP: '+name,()=>{
  const v=over===null?null:{...ok(),...over};
  assert.deepEqual(assessRestart(v),{decision:'STOP',reason});
});
test('GUI logon still requires proven Codex resume and Job empty',()=>{
  const e=ok();e.isGuiTask=true;e.bootMode='logon';
  assert.equal(assessRestart(e).decision,'ELIGIBLE');
  e.jobEmptyConfirmed=false;
  assert.equal(assessRestart(e).decision,'STOP');
});
