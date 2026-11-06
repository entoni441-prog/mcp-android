// Fail-closed durable STOP notification outbox. This module never sends messages.
// A separate authenticated delivery plugin must send and acknowledge externally.
// No secrets, prompts, paths, tokens, or process IDs are stored.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const id=/^[A-Za-z0-9_-]{1,64}$/;
const allowed=new Set(['OWNER_STOP','BUDGET_EXHAUSTED','RECONCILIATION_REQUIRED',
  'PROCESS_TREE_UNVERIFIED','RECOVERY_NOT_ENABLED','NATIVE_RECOVERY_UNSAFE',
  'STABILITY_NOT_PROVEN','ENVIRONMENT_CHANGED','SINGLE_INSTANCE_UNPROVEN',
  'TASK_IDENTITY_UNPROVEN','PRIOR_PROCESS_ALIVE','SESSION_UNVERIFIED',
  'EPOCH_INVALID','BUDGET_CORRUPT','UNKNOWN_STOP']);
const file=(dir,epoch)=>path.join(dir,'stop-notice-e'+String(epoch).padStart(4,'0')+'.json');
function validate(dir,taskId,epoch){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||!id.test(taskId)||
     !Number.isSafeInteger(epoch)||epoch<0||epoch>9999)throw Error('BAD_STOP_INPUT');
}
async function exclusive(name,obj){
  const temp=name+'.'+crypto.randomUUID()+'.tmp';
  const h=await fs.open(temp,'wx',0o600);
  try{await h.writeFile(JSON.stringify(obj)+'\n');await h.sync();}finally{await h.close();}
  try{
    await fs.link(temp,name);
    try{const dir=await fs.open(path.dirname(name),'r');try{await dir.sync();}finally{await dir.close();}}catch{}
  }finally{await fs.unlink(temp).catch(()=>{});}
}
async function read(name){
  const st=await fs.lstat(name);
  if(!st.isFile()||st.isSymbolicLink()||st.size>1024)throw Error('NOTICE_UNSAFE');
  return JSON.parse(await fs.readFile(name,'utf8'));
}
export async function queueStopNotice(dir,{taskId,epoch,reason}){
  validate(dir,taskId,epoch);
  const canonical=allowed.has(reason)?reason:'UNKNOWN_STOP';
  const record={version:1,taskId,epoch,status:'STOP',reason:canonical};
  const target=file(dir,epoch);
  try{await exclusive(target,record);return Object.freeze({decision:'QUEUED',reason:canonical});}
  catch(e){
    if(e.code!=='EEXIST')return Object.freeze({decision:'STOP',reason:'NOTICE_IO_ERROR'});
    try{
      const previous=await read(target);
      if(JSON.stringify(previous)===JSON.stringify(record))
        return Object.freeze({decision:'ALREADY_QUEUED',reason:canonical});
      return Object.freeze({decision:'STOP',reason:'NOTICE_CONFLICT'});
    }catch{return Object.freeze({decision:'STOP',reason:'NOTICE_UNREADABLE'});}
  }
}
export async function listUndeliveredStopNotices(dir,taskId){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||!id.test(taskId))throw Error('BAD_STOP_INPUT');
  try{
    const names=(await fs.readdir(dir)).filter(x=>x.startsWith('stop-notice-'));
    if(names.some(x=>!/^stop-notice-e\d{4}\.json$/.test(x)))
      return {decision:'STOP',reason:'NOTICE_UNKNOWN_FILE'};
    const pending=[];
    for(const name of names.sort()){
      const record=await read(path.join(dir,name));
      const expected=file(dir,record.epoch);
      if(path.basename(expected)!==name||record.version!==1||record.taskId!==taskId||
         record.status!=='STOP'||!allowed.has(record.reason)||
         Object.keys(record).length!==5)
        return {decision:'STOP',reason:'NOTICE_CONFLICT'};
      // A notice cannot be acknowledged by this module: delivery requires
      // a real provider receipt, not a locally forged boolean.
      pending.push(record);
    }
    return {decision:'PENDING',items:pending};
  }catch{return {decision:'STOP',reason:'NOTICE_UNREADABLE'};}
}
