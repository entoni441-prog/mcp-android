// MANUAL, ISOLATED read-only actual Codex CLI test.
// 1. Complete a newly created diagnostic session so its thread is persisted.
// 2. Resume that EXACT UUID and kill only this newly spawned CLI handle
//    after the resume turn starts (no shell/PID search/process enumeration).
// 3. Resume the SAME UUID again, read-only, and verify completed text.
// No external effects, no production changes, no Scheduler/Host modification.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

const [cwd,binary]=process.argv.slice(2);
const allowed=process.platform==='win32'&&process.argv.length===4&&
  typeof cwd==='string'&&path.isAbsolute(cwd)&&
  cwd.includes('nexus-codex-crash-saved-20261106')&&
  typeof binary==='string'&&path.isAbsolute(binary)&&
  path.basename(binary).toLowerCase()==='codex.exe';
if(!allowed)process.exit(64);
if(!(await fs.stat(binary)).isFile())process.exit(65);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const now=Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
let spawned=[],uuid,baseline,crashed,restarted;
const after=()=>({elapsedMs:Date.now()-now});
function create(args,onEvent){
  const child=spawn(binary,args,{
    cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],env:process.env
  });
  let buffer='',events=[],stderr='',ended=false;
  spawned.push(child);
  child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-1000);});
  child.stdout.on('data',b=>{
    buffer+=b.toString();
    if(buffer.length>160000){child.kill('SIGKILL');return;}
    while(buffer.includes('\n')){
      const at=buffer.indexOf('\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+1);
      let x;try{x=JSON.parse(line);}catch{continue;}
      events.push(x);
      try{onEvent?.(x,child);}catch{}
    }
  });
  const result=new Promise(resolve=>{
    child.once('exit',(code,signal)=>{ended=true;resolve({code,signal});});
    child.once('error',e=>{ended=true;resolve({error:e.code||'SPAWN_FAILURE'});});
  });
  return {child,events,result,
    get stderrKind(){
      const t=stderr.toLowerCase();
      if(/session.*not found|not found.*session/.test(t))return 'SESSION_NOT_FOUND';
      if(/unauthorized|login|authentication/.test(t))return 'AUTH_REQUIRED';
      if(/usage:|unknown argument/.test(t))return 'CLI_ARGUMENT_ERROR';
      return t?'OTHER':'NONE';
    }
  };
}
async function bounded(p,ms,tag){
  let timeout;
  try{return await Promise.race([p,new Promise((_,reject)=>{
    timeout=setTimeout(()=>reject(Error(tag)),ms);
  })]);}finally{clearTimeout(timeout);}
}
async function settle(run,ms,label){
  const d=await bounded(run.result,ms,label);
  await sleep(180);
  run.child.stdout?.destroy();run.child.stderr?.destroy();run.child.unref();
  return d;
}
const baselinePrompt='This is a harmless read-only diagnostic. Do not use tools or edit files. Reply with exactly NEXUS-SAVED-SESSION-OK.';
const crashPrompt='This is an isolated read-only crash test of a previously persisted thread. Do not use tools or edit files. Explain the difference between a process exit and a closed stdout pipe in about 200 words.';
const verifyPrompt='This is a harmless read-only post-crash diagnostic. Do not use tools or edit files. Reply exactly NEXUS-EXACT-THREAD-RECOVERED.';
let stage='BASELINE';
try{
  baseline=create(['exec','--json','--sandbox','read-only','-C',cwd,baselinePrompt]);
  const first=await settle(baseline,35000,'BASELINE_TIMEOUT');
  const firstId=baseline.events.find(x=>x.type==='thread.started')?.thread_id;
  const firstAnswer=baseline.events.some(x=>x.type==='item.completed'&&
    x.item?.type==='agent_message'&&x.item.text?.includes('NEXUS-SAVED-SESSION-OK'));
  if(first.code!==0||!UUID.test(firstId)||!firstAnswer||
     !baseline.events.some(x=>x.type==='turn.completed'))
    throw Error('BASELINE_NOT_PERSISTED');
  uuid=firstId;
  stage='INTERRUPT';
  let didKill=false,turnStarted=false,turnFinished=false;
  crashed=create(['exec','resume','--json','-c','sandbox_mode="read-only"',
    uuid,crashPrompt],(event,proc)=>{
    if(event.type==='turn.started' && !didKill){
      turnStarted=true;didKill=proc.kill('SIGKILL');
    }
    if(event.type==='turn.completed')turnFinished=true;
  });
  const killed=await settle(crashed,20000,'INTERRUPT_TIMEOUT');
  if(!turnStarted||!didKill||killed.code===0||killed.error||
     !crashed.events.some(x=>x.type==='thread.started'&&x.thread_id===uuid))
    throw Error('INTERRUPT_UNVERIFIED');
  stage='EXACT_RESUME';
  restarted=create(['exec','resume','--json','-c','sandbox_mode="read-only"',
    uuid,verifyPrompt]);
  const again=await settle(restarted,55000,'RESUME_TIMEOUT');
  const same=restarted.events.some(x=>x.type==='thread.started'&&x.thread_id===uuid);
  const answer=restarted.events.some(x=>x.type==='item.completed'&&
    x.item?.type==='agent_message'&&x.item.text?.includes('NEXUS-EXACT-THREAD-RECOVERED'));
  const complete=restarted.events.some(x=>x.type==='turn.completed');
  const passed=again.code===0&&same&&answer&&complete;
  console.log(JSON.stringify({status:passed?'PASS':'FAIL',test:'PERSISTED_THREAD_CLI_CRASH',
    baselineSaved:true,interruptedTurnStarted:turnStarted,
    interruptedTurnCompleted:turnFinished,killAccepted:didKill,
    interruptedExitCode:killed.code,interruptedSignal:killed.signal,
    resumedSameThread:same,completed:complete,expectedText:answer,
    resumeExitCode:again.code,resumeStderrKind:restarted.stderrKind,...after()}));
  process.exitCode=passed?0:2;
}catch(e){
  console.log(JSON.stringify({status:'STOP',test:'PERSISTED_THREAD_CLI_CRASH',
    phase:stage,reason:String(e.message).slice(0,80),
    baselineSaved:!!uuid,interruptedEvents:crashed?.events?.map(x=>x.type).slice(0,12),
    interruptedStderrKind:crashed?.stderrKind,postCrashStderrKind:restarted?.stderrKind,
    ...after()}));
  process.exitCode=3;
}finally{
  // Only exact ChildProcess handles this script created; never touch user apps.
  for(const p of spawned){
    try{p.kill('SIGKILL');}catch{}
    p.stdout?.destroy();p.stderr?.destroy();p.unref();
  }
}
