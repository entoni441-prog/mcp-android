import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const TASK='nx-cli-live-20261106';
const EFFECT=TASK+':effect-once\n';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function stop(){console.error('PILOT_STOP');process.exitCode=1;}
async function put(file,s){const h=await fs.open(file,'wx');try{await h.writeFile(s);await h.sync();}finally{await h.close();}}
async function run(mode,dir){
  if(!['start','resume'].includes(mode)||!dir||!path.isAbsolute(dir))throw Error('bad_arg');
  const real=await fs.realpath(dir);
  const temp=await fs.realpath(os.tmpdir());
  const parent=path.dirname(real);
  if(path.basename(real)!=='work'||!path.basename(parent).startsWith('nexus-codex-live-')||path.dirname(parent).toLowerCase()!==temp.toLowerCase())throw Error('unsafe_dir');
  const meta=await fs.lstat(real);
  if(!meta.isDirectory()||meta.isSymbolicLink())throw Error('unsafe_dir');
  const current=(await fs.readdir(real)).sort();
  const cp=path.join(real,'checkpoint.json'),effect=path.join(real,'effect-once.txt'),complete=path.join(real,'complete.json');
  if(mode==='start'){
    if(current.length)throw Error('not_empty');
    await put(cp,JSON.stringify({taskId:TASK,stage:'awaiting_cli_crash',pid:process.pid})+'\n');
    await put(effect,EFFECT);
    console.log('PILOT_READY pid='+process.pid);
    await sleep(90000);
    throw Error('not_crashed');
  }
  if(current.join(',')!=='checkpoint.json,effect-once.txt')throw Error('unexpected_files');
  for(const f of [cp,effect]){
    const s=await fs.lstat(f);
    if(!s.isFile()||s.isSymbolicLink()||s.size>1024)throw Error('unsafe_file');
  }
  const j=JSON.parse(await fs.readFile(cp,'utf8'));
  if(j.taskId!==TASK||j.stage!=='awaiting_cli_crash'||!Number.isInteger(j.pid)||j.pid<1)throw Error('bad_checkpoint');
  if(await fs.readFile(effect,'utf8')!==EFFECT)throw Error('bad_effect');
  await put(complete,JSON.stringify({taskId:TASK,status:'completed'})+'\n');
  console.log('PILOT_RECOVERED');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  run(process.argv[2],process.argv[3]).catch(stop);
}
export {run};
