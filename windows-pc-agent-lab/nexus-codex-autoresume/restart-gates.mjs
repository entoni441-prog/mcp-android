// Experimental restart decision layer. Pure logic: NO process control, filesystem writes,
// Windows Scheduler changes, network, or automatic Codex execution.
// The caller must obtain evidence independently from OS-owned handles, durable state
// and receipts; booleans in untrusted JSON are NOT authentication.
const STOP = reason => Object.freeze({decision:'STOP',reason});
const validOpId = v => typeof v==='string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const validEpoch = v => Number.isSafeInteger(v) && v>=0;
export function assessRestart(e) {
  if(!e||typeof e!=='object'||Array.isArray(e))return STOP('EVIDENCE_MISSING');
  if(e.ownerApproved!==true)return STOP('UNAPPROVED');
  if(e.ownerStop!==false)return STOP('OWNER_STOP_OR_UNKNOWN');
  if(e.schedulerSingleInstance!==true||e.osMutexOwned!==true)return STOP('SINGLE_INSTANCE_UNPROVEN');
  if(e.taskMatches!==true||e.exclusiveClaimsMatch!==true)return STOP('TASK_IDENTITY_UNPROVEN');
  if(e.codeHashMatches!==true||e.branchMatches!==true||e.worktreeClean!==true)return STOP('ENVIRONMENT_CHANGED');
  if(!validEpoch(e.epoch)||!validEpoch(e.previousEpoch)||e.epoch!==e.previousEpoch+1)return STOP('EPOCH_INVALID');
  if(e.restartBudgetDurable!==true)return STOP('RESTART_BUDGET_UNVERIFIED');
  if(!Number.isSafeInteger(e.restartCount)||e.restartCount<0||e.restartCount>5)return STOP('RESTART_BUDGET_EXHAUSTED');
  if(e.bootMode!=='normal'&&e.bootMode!=='logon')return STOP('BOOT_MODE_UNVERIFIED');
  if(e.isGuiTask===true&&e.bootMode!=='logon')return STOP('GUI_REQUIRES_LOGON');
  if(e.rebootDetected!==false&&e.rebootDetected!==true)return STOP('REBOOT_STATE_UNVERIFIED');
  if(e.rebootDetected===true&&e.codexResumeAfterRebootProven!==true)return STOP('REBOOT_RESUME_UNPROVEN');
  // Stale heartbeat is an alarm, never itself proof that a prior worker is gone.
  if(e.guardianKnownAlive===true||e.controllerKnownAlive===true||e.codexKnownAlive===true)return STOP('PRIOR_PROCESS_ALIVE');
  if(e.heartbeatStale!==true||e.priorGuardianExitVerified!==true)return STOP('DEATH_UNVERIFIED');
  // A prior active process must be contained by a non-breakaway Windows Job Object.
  // Zero active processes must be verified on the OS Job Object, not taskkill /t.
  if(e.jobAssignmentConfirmed!==true||e.jobEmptyConfirmed!==true)return STOP('PROCESS_TREE_UNVERIFIED');
  if(e.priorAttemptAlreadyResumed!==false)return STOP('RECOVERY_ALREADY_CONSUMED');
  if(e.exactSessionPersisted!==true)return STOP('SESSION_UNVERIFIED');
  if(e.completionReceiptValid===true)return Object.freeze({decision:'COMPLETE',reason:'RECEIPT_CONFIRMED'});
  if(e.completionReceiptValid!==false)return STOP('RECEIPT_UNVERIFIED');
  const op=e.operation;
  if(!op||typeof op!=='object'||!validOpId(op.operationId))return STOP('OPERATION_UNVERIFIED');
  if(!validEpoch(op.epoch)||op.epoch!==e.previousEpoch)return STOP('OPERATION_EPOCH_MISMATCH');
  if(op.state==='COMMITTED'){
    return op.externalReceiptVerified===true ?
      Object.freeze({decision:'COMPLETE',reason:'OPERATION_COMMITTED'}) :
      STOP('COMMIT_UNVERIFIED');
  }
  if(op.state==='IN_FLIGHT'){
    // Conservative: even idempotent external APIs need a confirmed server-side
    // result or a provider-enforced dedupe key. This engine never blindly replays.
    return STOP('RECONCILIATION_REQUIRED');
  }
  if(op.state!=='PREPARED')return STOP('OPERATION_STATE_UNVERIFIED');
  if(op.externalEffectMayHaveStarted!==false)return STOP('EFFECT_BOUNDARY_UNVERIFIED');
  if(e.resumeBudgetRemaining!==1)return STOP('RESUME_BUDGET_UNVERIFIED');
  return Object.freeze({decision:'ELIGIBLE',reason:'ONE_EXACT_THREAD_RESUME_WITH_DURABLE_FENCE',epoch:e.epoch});
}
