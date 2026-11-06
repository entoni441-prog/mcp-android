// Experimental durable restart attempt accounting. NO process creation,
// recovery authorization, Scheduler writes, or automatic stability reset.
// This is an accounting fence, NOT a token that authorizes Codex execution.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ID=/^[A-Za-z0-9_-]{1,64}$/;
const MAX=5;
const STABLE_MS=30*60*1000;
const stop=reason=>Object.freeze({decision:'STOP',reason});
const hash=data=>crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
function check(dir,taskId){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||!ID.test(taskId))throw Error('INVALID_BUDGET_INPUT');
}
const anchor=dir=>path.join(dir,'budget-anchor.json');
const attempt=(dir,n)=>path.join(dir,'budget-attempt-'+String(n).padStart(3,'0')+'.json');
async function readExact(file){
  try{
    const st=await fs.lstat(file);
    if(!st.isFile()||st.isSymbolicLink()||st.size>2048)throw Error('BUDGET_CORRUPT');
    return JSON.parse(await fs.readFile(file,'utf8'));
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function exact(a,b){
  return a&&typeof a==='object'&&!Array.isArray(a)&&Object.keys(a).length===Object.keys(b).length&&
    Object.entries(b).every(([k,v])=>a[k]===v);
}
async function durableExclusive(file,data){
  const temp=file+'.'+crypto.randomUUID()+'.tmp';
  const h=await fs.open(temp,'wx',0o600);
  try{await h.writeFile(JSON.stringify(data)+'\n');await h.sync();}finally{await h.close();}
  try{
    // A cross-process atomic, create-only publication. A crash after link
    // consumes the attempt even if the runner never started (fail closed).
    await fs.link(temp,file);
    try{const folder=await fs.open(path.dirname(file),'r');try{await folder.sync();}finally{await folder.close();}}catch{}
  }finally{await fs.unlink(temp).catch(()=>{});}
}
async function checkedState(dir,taskId){
  const a=await readExact(anchor(dir));
  if(!a)return stop('BUDGET_NOT_INITIALIZED');
  const expected={version:1,taskId,baseEpoch:0,maxAttempts:MAX};
  if(!exact(a,expected))return stop('BUDGET_CORRUPT');
  let previous=hash(a),used=0;
  const entries=await fs.readdir(dir);
  const owned=entries.filter(x=>x.startsWith('budget-'));
  if(owned.some(x=>x!=='budget-anchor.json'&&!/^budget-attempt-\d{3}\.json$/.test(x)))
    return stop('BUDGET_UNKNOWN_RECEIPT');
  for(let n=1;n<=MAX;n++){
    const f=attempt(dir,n),value=await readExact(f);
    if(!value){
      // Gaps are never recoverable by assuming later files are harmless.
      if(owned.some(x=>/^budget-attempt-\d{3}\.json$/.test(x)&&Number(x.slice(15,18))>=n))
        return stop('BUDGET_GAP');
      break;
    }
    const expectedRow={version:1,taskId,attempt:n,epoch:n,prevHash:previous};
    if(!exact(value,expectedRow))return stop('BUDGET_CORRUPT');
    previous=hash(value);used=n;
  }
  if(owned.some(x=>/^budget-attempt-\d{3}\.json$/.test(x)&&Number(x.slice(15,18))>MAX))
    return stop('BUDGET_OVERFLOW');
  return Object.freeze({decision:'READY',taskId,used,remaining:MAX-used,nextEpoch:used+1,headHash:previous});
}
export async function initializeRecoveryBudget(dir,taskId){
  check(dir,taskId);
  await durableExclusive(anchor(dir),{version:1,taskId,baseEpoch:0,maxAttempts:MAX});
  return Object.freeze({decision:'READY',remaining:MAX,nextEpoch:1});
}
export async function inspectRecoveryBudget(dir,taskId){
  check(dir,taskId);
  try{return await checkedState(dir,taskId);}
  catch{return stop('BUDGET_UNREADABLE');}
}
export async function claimRecoveryAttempt(dir,taskId,expectedEpoch){
  check(dir,taskId);
  if(!Number.isSafeInteger(expectedEpoch)||expectedEpoch<1||expectedEpoch>MAX)
    return stop('EPOCH_INVALID');
  const state=await inspectRecoveryBudget(dir,taskId);
  if(state.decision!=='READY')return state;
  if(state.remaining===0)return stop('BUDGET_EXHAUSTED');
  if(expectedEpoch!==state.nextEpoch)return stop('EPOCH_MISMATCH');
  const value={version:1,taskId,attempt:state.used+1,epoch:expectedEpoch,prevHash:state.headHash};
  try{await durableExclusive(attempt(dir,state.used+1),value);}
  catch(e){if(e.code==='EEXIST')return stop('ATTEMPT_ALREADY_CLAIMED');return stop('BUDGET_IO_ERROR');}
  return Object.freeze({decision:'CLAIMED',epoch:expectedEpoch,attempt:state.used+1,remaining:MAX-state.used-1});
}
export function assessStableReset(evidence){
  // Advisory only: callers' booleans and times are NOT OS-attested.
  // Do not create a reset receipt from this function.
  if(!evidence||evidence.sameBoot!==true||
     evidence.exclusiveJobContinuouslyOwned!==true||
     evidence.heartbeatContinuouslyVerified!==true||
     evidence.ownerStopAbsent!==true||
     evidence.processTreeStable!==true)return stop('STABILITY_NOT_PROVEN');
  if(!Number.isSafeInteger(evidence.monotonicObservedMs)||
     evidence.monotonicObservedMs<STABLE_MS)return stop('STABILITY_WINDOW_INCOMPLETE');
  return Object.freeze({decision:'NEEDS_NATIVE_ATTESTATION',minimumMs:STABLE_MS});
}
// There is deliberately no mutable reset API until a native-owned 30-minute
// continuous-observation proof and reboot-bound monotonic clock are available.
