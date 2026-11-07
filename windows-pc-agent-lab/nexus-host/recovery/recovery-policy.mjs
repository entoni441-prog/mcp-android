/** NEXUS independent scheduled-recovery policy. No network, shells, or side effects. */
export const WINDOW_MS=30*60_000;
export const STABLE_MS=30*60_000;
export const MAX_STARTS=3;
export const RETRY_GAP_MS=2*60_000;

/** Every recovery attempt starts only the PREINSTALLED NEXUS-Host-Run task.
 * No kill, no logon, no power change, no deployment, no capability changes.
 */
export function decideRecovery({now,healthy,ownerOff,existingHostAlive,taskVerified,state={}}){
  if(!Number.isSafeInteger(now)||now<0||typeof healthy!=='boolean'||typeof ownerOff!=='boolean'||
     typeof existingHostAlive!=='boolean'||typeof taskVerified!=='boolean')throw Error('bad_observation');
  const attempts=Array.isArray(state.attempts)?state.attempts:[];
  if(attempts.some((t,i)=>!Number.isSafeInteger(t)||t<0||t>now||(i>0&&t<=attempts[i-1])))throw Error('bad_journal');
  const recent=attempts.filter(t=>now-t<WINDOW_MS);
  const healthySince=Number.isSafeInteger(state.healthySince)&&state.healthySince<=now?state.healthySince:null;
  if(ownerOff)return {action:'OWNER_OFF',next:{attempts:recent,healthySince:null}};
  if(healthy){
    const since=healthySince??now;
    return {action:'HEALTHY',next:{attempts:now-since>=STABLE_MS?[]:recent,healthySince:since}};
  }
  const next={attempts:recent,healthySince:null};
  if(existingHostAlive)return {action:'HOST_ALIVE_UNHEALTHY_STOP',next};
  if(!taskVerified)return {action:'TASK_IDENTITY_UNVERIFIED',next};
  if(recent.length>=MAX_STARTS)return {action:'RESTART_BUDGET_EXHAUSTED',next};
  if(recent.length && now-recent[recent.length-1]<RETRY_GAP_MS)return {action:'RETRY_COOLDOWN',next};
  return {action:'START_EXISTING_TASK',next:{...next,attempts:[...recent,now]}};
}
