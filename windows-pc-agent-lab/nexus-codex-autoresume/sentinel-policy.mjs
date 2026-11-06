// Pure, side-effect-free recovery eligibility policy.
// This module NEVER launches, terminates, or discovers processes.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stop=reason=>Object.freeze({decision:'STOP',reason});
export function assessRecovery(evidence) {
  if(!evidence||typeof evidence!=='object'||Array.isArray(evidence))return stop('EVIDENCE_MISSING');
  const e=evidence;
  if(e.manifestApproved!==true)return stop('NOT_APPROVED');
  if(e.ownerStop!==false)return stop('OWNER_STOP_OR_UNKNOWN');
  if(e.guardianExitObserved!==true||e.guardianIdentityVerified!==true)return stop('GUARDIAN_DEATH_UNPROVEN');
  if(e.claimsMatch!==true)return stop('CLAIMS_UNVERIFIED');
  if(e.gitClean!==true||e.branchMatches!==true||e.binaryHashMatches!==true)return stop('ENVIRONMENT_UNVERIFIED');
  if(e.guardianGone!==true||e.controllerGone!==true||e.cliGone!==true)return stop('PROCESS_STILL_ALIVE_OR_UNKNOWN');
  if(e.rescueClaimExists!==false||e.guardianResumeClaimExists!==false)return stop('RECOVERY_ALREADY_CLAIMED');
  if(typeof e.taskId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(e.taskId)||e.stateTaskId!==e.taskId)return stop('TASK_MISMATCH');
  if(e.completionMarkerValid===true){
    if(e.stateStatus==='STOP')return stop('PRIOR_TERMINAL_STOP');
    return Object.freeze({decision:'COMPLETE',reason:'COMPLETION_MARKER',attempt:e.attempt});
  }
  if(e.completionMarkerValid!==false)return stop('MARKER_UNVERIFIED');
  if(e.stateStatus!=='RUNNING'||e.attempt!==0||e.recordedStatus!==null)return stop('STATE_NOT_RECOVERABLE');
  if(typeof e.threadId!=='string'||!UUID.test(e.threadId))return stop('THREAD_UNVERIFIED');
  if(!Number.isSafeInteger(e.controllerPid)||e.controllerPid<1||!Number.isSafeInteger(e.cliPid)||e.cliPid<1)return stop('PID_UNVERIFIED');
  if(e.controllerPid===e.cliPid)return stop('PID_COLLISION');
  return Object.freeze({decision:'ELIGIBLE_FOR_SINGLE_RESUME',reason:'EXACT_THREAD_WITH_FENCE_REQUIRED',attempt:1});
}
