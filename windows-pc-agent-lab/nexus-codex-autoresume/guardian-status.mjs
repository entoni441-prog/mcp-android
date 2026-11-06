import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const safeStatus=new Set(['CREATED','RUNNING','RECOVERING','COMPLETED','STOP']);
const fields=new Set(['taskId','status','reason','attempt','childPid','threadId']);
function sanitized(s){
  if(!s||typeof s!=='object'||!safeStatus.has(s.status))return {status:'UNKNOWN'};
  const r={};
  for(const k of fields)if(Object.hasOwn(s,k))r[k]=s[k];
  if(typeof r.taskId!=='string'||typeof r.reason!=='string')return {status:'UNKNOWN'};
  if(r.threadId!==null&&typeof r.threadId!=='string')delete r.threadId;
  if(!Number.isSafeInteger(r.childPid))delete r.childPid;
  if(!Number.isSafeInteger(r.attempt))delete r.attempt;
  return r;
}
export async function readGuardianStatus(stateDirectory){
  if(typeof stateDirectory!=='string'||!path.isAbsolute(stateDirectory))return {status:'STOP',reason:'PATH_REQUIRED'};
  try{
    const dir=await fs.realpath(stateDirectory);
    const read=async name=>{
      const file=path.join(dir,name);
      const stat=await fs.lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw Error('UNSAFE_FILE');
      return JSON.parse(await fs.readFile(file,'utf8'));
    };
    const [state,guardian]=await Promise.all([
      read('state.json').catch(()=>null),
      read('guardian-result.json').catch(()=>null)
    ]);
    return {controller:sanitized(state),guardian:sanitized(guardian)};
  }catch{return {status:'STOP',reason:'STATUS_UNAVAILABLE'};}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const answer=process.argv.length===3?await readGuardianStatus(process.argv[2]):{status:'STOP',reason:'USAGE'};
  console.log(JSON.stringify(answer));
}
