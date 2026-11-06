// Test-only *real controller runtime* with its event loop deliberately blocked
// after the mock Codex produced a durable IN_FLIGHT effect and exact thread state.
// A supervising Guardian must detect lost controller heartbeat without relying
// on PID existence; the native Job Object then owns killing the entire tree.
import fs from 'node:fs/promises';
import path from 'node:path';
import {runManifest} from '../controller.mjs';

if(process.argv.length!==4)process.exit(64);
const m=JSON.parse(process.argv[2]),opts=JSON.parse(process.argv[3]);
if(!m||typeof m!=='object'||typeof m.stateDirectory!=='string'||
   !path.isAbsolute(m.stateDirectory)||!m.stateDirectory.includes('nexus-job-test-')||
   typeof opts.testScript!=='string'||
   path.basename(opts.testScript)!=='guarded-fake-codex.mjs')process.exit(65);
const root=path.dirname(m.stateDirectory),pid=process.pid;
const hb=path.join(root,'controller-heartbeat-'+pid+'.txt');
let blocking=false;
const beat=setInterval(async()=>{
  if(!blocking)try{await fs.writeFile(hb,String(Date.now()));}catch{}
},90);
await fs.writeFile(hb,String(Date.now()));
const active=runManifest(m,opts);
const detect=setInterval(async()=>{
  if(blocking)return;
  try{
    const state=JSON.parse(await fs.readFile(path.join(m.stateDirectory,'state.json'),'utf8'));
    const checkpoint=JSON.parse(await fs.readFile(path.join(m.stateDirectory,'checkpoint.json'),'utf8'));
    if(state.status!=='RUNNING'||!state.threadId||state.childPid!==checkpoint.pid)return;
    process.kill(checkpoint.pid,0); // liveness probe only, never terminate a PID
    blocking=true;
    const marker=path.join(root,'controller-hang-observed.json');
    await fs.writeFile(marker,JSON.stringify({controllerPid:pid,childPid:checkpoint.pid,eventLoopBlocked:true}));
    clearInterval(beat);clearInterval(detect);
    // Synchronous stall within the ACTUAL process executing runManifest.
    // The controller and its child stay alive but callbacks no longer run.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);
  }catch{}
},90);
try{
  const result=await active;
  clearInterval(beat);clearInterval(detect);
  if(result.status==='COMPLETED')process.exit(0);
  process.exit(21);
}catch{
  clearInterval(beat);clearInterval(detect);
  process.exit(22);
}
