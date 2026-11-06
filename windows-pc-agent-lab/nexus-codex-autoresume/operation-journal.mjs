import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

// Append-only operation journal. No external effects, process control or retries.
// An IN_FLIGHT record is durably installed BEFORE calling the external API.
// Each record carries epoch, operationId and only bounded nonsecret fields.
// An old epoch's COMMITTED cannot certify another epoch's work.
const name=/^[A-Za-z0-9_-]{1,64}$/;
function valid(taskId,operationId,epoch){
  if(!name.test(taskId)||!name.test(operationId)||!Number.isSafeInteger(epoch)||epoch<0)throw Error('BAD_ID');
}
function location(dir,taskId,operationId,epoch,stage){
  if(typeof dir!=='string'||!path.isAbsolute(dir))throw Error('BAD_DIR');
  valid(taskId,operationId,epoch);
  return path.join(dir,taskId+'-'+operationId+'-e'+epoch+'-'+stage+'.json');
}
async function durableCreate(file,data){
  const temp=file+'.'+crypto.randomUUID()+'.tmp';
  const h=await fs.open(temp,'wx',0o600);
  try{await h.writeFile(JSON.stringify(data)+'\n');await h.sync();}
  finally{await h.close();}
  try{
    // Hard-linking the fsynced temp provides atomic, exclusive publication:
    // no rename-replace of a previous receipt, same filesystem and directory.
    await fs.link(temp,file);
    try{const folder=await fs.open(path.dirname(file),'r');try{await folder.sync();}finally{await folder.close();}}catch{}
  }finally{await fs.unlink(temp).catch(()=>{});}
}
async function read(file){
  try{
    const st=await fs.lstat(file);
    if(!st.isFile()||st.isSymbolicLink()||st.size>2048)throw Error('UNSAFE_JOURNAL');
    return JSON.parse(await fs.readFile(file,'utf8'));
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function marker(taskId,operationId,epoch,stage){
  return {taskId,operationId,epoch,stage};
}
export async function prepareOperation(dir,{taskId,operationId,epoch}){
  const file=location(dir,taskId,operationId,epoch,'PREPARED');
  await durableCreate(file,marker(taskId,operationId,epoch,'PREPARED'));
  return {stage:'PREPARED'};
}
export async function beginExternalOperation(dir,{taskId,operationId,epoch}){
  const prior=await getOperation(dir,{taskId,operationId,epoch});
  if(prior.stage!=='PREPARED')throw Error('NOT_PREPARED');
  await durableCreate(location(dir,taskId,operationId,epoch,'IN_FLIGHT'),marker(taskId,operationId,epoch,'IN_FLIGHT'));
  return {stage:'IN_FLIGHT'};
}
export async function confirmOperation(dir,{taskId,operationId,epoch},receipt){
  if(!receipt||receipt.verified!==true||typeof receipt.externalId!=='string'||!name.test(receipt.externalId))throw Error('RECEIPT_UNVERIFIED');
  const prior=await getOperation(dir,{taskId,operationId,epoch});
  if(prior.stage!=='IN_FLIGHT')throw Error('NOT_IN_FLIGHT');
  await durableCreate(location(dir,taskId,operationId,epoch,'COMMITTED'),{
    ...marker(taskId,operationId,epoch,'COMMITTED'),externalId:receipt.externalId
  });
  return {stage:'COMMITTED'};
}
export async function getOperation(dir,{taskId,operationId,epoch}){
  valid(taskId,operationId,epoch);
  for(const stage of ['COMMITTED','IN_FLIGHT','PREPARED']){
    const v=await read(location(dir,taskId,operationId,epoch,stage));
    if(v){
      const expected=marker(taskId,operationId,epoch,stage);
      if(Object.entries(expected).some(([k,val])=>v[k]!==val))throw Error('JOURNAL_MISMATCH');
      if(stage==='COMMITTED'&&(!name.test(v.externalId)||Object.keys(v).some(k=>!['taskId','operationId','epoch','stage','externalId'].includes(k))))throw Error('JOURNAL_MISMATCH');
      if(stage!=='COMMITTED'&&Object.keys(v).length!==4)throw Error('JOURNAL_MISMATCH');
      return {stage,epoch,externalId:stage==='COMMITTED'?v.externalId:undefined};
    }
  }
  return {stage:'UNREGISTERED',epoch};
}
export async function recoveryDisposition(dir,identity,currentEpoch){
  const op=await getOperation(dir,identity);
  if(!Number.isSafeInteger(currentEpoch)||currentEpoch<identity.epoch)return {decision:'STOP',reason:'EPOCH_UNVERIFIED'};
  if(op.stage==='COMMITTED')return {decision:'COMPLETE',reason:'RECEIPT_EXISTS'};
  if(op.stage==='IN_FLIGHT')return {decision:'STOP',reason:'RECONCILIATION_REQUIRED'};
  if(op.stage==='PREPARED'&&currentEpoch===identity.epoch)return {decision:'ELIGIBLE_TO_START_ONCE',reason:'NOT_YET_IN_FLIGHT'};
  return {decision:'STOP',reason:'NO_SAFE_AUTOMATIC_ACTION'};
}
