import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const id='nx-supervisor-real-20261106';
const effect=id+':single-effect\n';
const fail=()=>{console.error('PILOT_STOP');process.exitCode=1;};
async function writeOnce(file,value){
  const h=await fs.open(file,'wx',0o600);
  try{await h.writeFile(value);await h.sync();}finally{await h.close();}
}
async function main(mode,dir){
  if(!['start','resume'].includes(mode)||typeof dir!=='string'||!path.isAbsolute(dir))throw Error('INVALID_INPUT');
  const root=await fs.realpath(dir),temp=await fs.realpath(os.tmpdir());
  const parent=path.dirname(root);
  if(path.basename(root)!=='work'||!path.basename(parent).startsWith('nexus-controller-live-')||path.dirname(parent).toLowerCase()!==temp.toLowerCase())throw Error('INVALID_PATH');
  const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('INVALID_PATH');
  const existing=(await fs.readdir(root)).sort();
  const cp=path.join(root,'checkpoint.json'),effectPath=path.join(root,'effect-once.txt'),complete=path.join(root,'complete.json');
  if(mode==='start'){
    if(existing.length!==0)throw Error('NOT_EMPTY');
    await writeOnce(cp,JSON.stringify({taskId:id,stage:'awaiting_controller_crash',pid:process.pid})+'\n');
    await writeOnce(effectPath,effect);
    console.log('CONTROLLER_PILOT_READY pid='+process.pid);
    await new Promise(r=>setTimeout(r,30000));
    throw Error('CRASH_NOT_OBSERVED');
  }
  if(existing.join(',')!=='checkpoint.json,effect-once.txt')throw Error('BAD_STATE');
  for(const p of [cp,effectPath]){
    const s=await fs.lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.size>1024)throw Error('BAD_STATE');
  }
  const j=JSON.parse(await fs.readFile(cp,'utf8'));
  if(j.taskId!==id||j.stage!=='awaiting_controller_crash'||!Number.isSafeInteger(j.pid)||j.pid<1||Object.keys(j).length!==3)throw Error('BAD_CHECKPOINT');
  if(await fs.readFile(effectPath,'utf8')!==effect)throw Error('BAD_EFFECT');
  await writeOnce(complete,JSON.stringify({taskId:id,status:'completed'})+'\n');
  console.log('CONTROLLER_PILOT_RECOVERED');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main(process.argv[2],process.argv[3]).catch(fail);
}
export {main};
