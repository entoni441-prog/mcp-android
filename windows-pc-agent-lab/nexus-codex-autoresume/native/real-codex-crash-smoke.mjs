// Opt-in isolated actual Codex CLI SIGKILL/read-only resume smoke.
// Does not touch existing Codex processes, saved tasks, NEXUS production,
// Windows Scheduler, Git refs, or perform any external side effect.
// Test CLI is newly spawned by THIS process and killed through its own handle.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cwd=process.argv[2],binary=process.argv[3];
if(process.platform!=='win32'||process.argv.length!==4||
   !path.isAbsolute(cwd)||!path.isAbsolute(binary)||
   path.basename(binary).toLowerCase()!=='codex.exe'||
   !cwd.includes('nexus-guardian-kernel-jobproof-20261106'))process.exit(64);
if(!(await fs.stat(binary)).isFile())process.exit(65);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const start=Date.now();
function limit(ms,label){return new Promise((_,reject)=>{
  const timer=setTimeout(()=>reject(Error(label)),ms);timer.unref();
});}
let thread=null,first=null,second=null,firstExited=false;
function create(args){
  const child=spawn(binary,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='',events=[];
  child.stderr.on('data',d=>{err=(err+d.toString()).slice(-1000);});
  // Process 'exit' is authoritative. 'close' can be delayed indefinitely
  // when a CLI descendant inherited an stdout/stderr pipe handle.
  const death=new Promise(resolve=>{
    child.once('exit',(code,signal)=>resolve({code,signal}));
    child.once('error',e=>resolve({error:e.code||'SPAWN_ERROR'}));
  });
  return {child,death,get events(){return events;},get err(){return err;},
    feed(cb){
      child.stdout.on('data',data=>{
        out+=data.toString();if(out.length>65536){out='';child.kill();return;}
        let newline;
        while((newline=out.indexOf('\n'))>=0){
          const line=out.slice(0,newline);out=out.slice(newline+1);
          let obj;try{obj=JSON.parse(line);}catch{continue;}
          events.push(obj);cb?.(obj);
        }
      });
    }};
}
const firstPrompt='This is an isolated read-only crash test. Do not invoke tools or modify files. Reply exactly NEXUS-CLI-CRASH-PRE.';
let firstStage;
try{
  first=create(['exec','--json','--sandbox','read-only','-C',cwd,firstPrompt]);
  const ready=new Promise((resolve,reject)=>{
    first.feed(e=>{
      if(e.type==='thread.started' && UUID.test(e.thread_id)){
        thread=e.thread_id;
        // The only terminated process is the handle we JUST spawned.
        first.child.kill('SIGKILL');
        resolve(thread);
      }
    });
    first.death.then(()=>{if(!thread)reject(Error('NO_THREAD_BEFORE_EXIT'))});
  });
  await Promise.race([ready,limit(12000,'THREAD_TIMEOUT')]);
  firstStage=await Promise.race([first.death,limit(7000,'KILL_TIMEOUT')]);
  first.child.stdout.destroy();first.child.stderr.destroy();first.child.unref();
  firstExited=true;
  if(!thread||firstStage?.error)throw Error('FIRST_NOT_KILLED');

  // Only the exact UUID emitted by this invocation may be resumed.
  second=create(['exec','resume','--json','-c','sandbox_mode="read-only"',
    thread,'This is an isolated read-only diagnostic. Do not invoke tools or modify files. Reply exactly NEXUS-CLI-CRASH-RESUMED.']);
  second.feed();
  const resumed=await Promise.race([second.death,limit(55000,'RESUME_TIMEOUT')]);
  // Let streamed JSONL finish briefly without trusting descendant pipe closure.
  await Promise.race([new Promise(resolve=>second.child.stdout.once('end',resolve)),
    limit(500,'OUTPUT_DRAIN_TIMEOUT').catch(()=>undefined)]);
  const events=second.events;
  const ids=events.filter(e=>e.type==='thread.started').map(e=>e.thread_id);
  const outputs=events.filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message').map(e=>e.item.text||'');
  const ok=resumed.code===0&&ids.length===1&&ids[0]===thread&&
    events.some(e=>e.type==='turn.completed')&&outputs.some(x=>x.includes('NEXUS-CLI-CRASH-RESUMED'));
  console.log(JSON.stringify({status:ok?'PASS':'FAIL',sameThread:ids.length===1&&ids[0]===thread,
    firstProcessTerminated:firstExited,firstExitCode:firstStage.code,
    secondExitCode:resumed.code,completed:events.some(e=>e.type==='turn.completed'),
    diagnosticResponse:outputs.some(x=>x.includes('NEXUS-CLI-CRASH-RESUMED')),
    elapsedMs:Date.now()-start}));
  process.exitCode=ok?0:2;
}catch(e){
  console.log(JSON.stringify({status:'STOP',reason:String(e.message).slice(0,90),
    firstProcessTerminated:firstExited,elapsedMs:Date.now()-start}));
  process.exitCode=3;
}finally{
  // No PID-based search or taskkill; only the two exact handles owned here.
  for(const p of [first,second]){
    if(p){
      try{p.child.kill('SIGKILL');}catch{}
      p.child.stdout?.destroy();p.child.stderr?.destroy();p.child.unref();
    }
  }
}
