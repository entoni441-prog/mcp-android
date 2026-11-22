// Internal launch adapter. No new MCP tool, no raw PID fallback, no auto-build.
// The reviewed helper must be installed beside this module by a future release.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const helper=fileURLToPath(new URL('./NexusJobHost.exe',import.meta.url));
const live=c=>c.exitCode===null && c.signalCode===null && !c.killed;
const pidOk=n=>Number.isInteger(n)&&n>0&&n<=2147483647;
const safeLaunch=(mode,exe,args)=>['task','browser'].includes(mode)&&typeof exe==='string'&&
  /^[A-Za-z]:\\/.test(exe)&&path.win32.extname(exe).toLowerCase()==='.exe'&&
  !exe.includes('\0')&&Array.isArray(args)&&args.length<=126&&args.every(a=>typeof a==='string'&&!a.includes('\0'));

export function launchContained(mode,exe,args,options={},deps={}) {
  if(!safeLaunch(mode,exe,args))throw Error('invalid_job_launch');
  const exists=deps.exists||fs.existsSync, spawnFn=deps.spawnFn||spawn;
  if(!exists(helper))throw Error('job_helper_unavailable');
  const child=spawnFn(helper,[mode,exe,...args],{cwd:options.cwd,shell:false,windowsHide:true,
    detached:false,stdio:['pipe','pipe','pipe']});
  let state='starting',rootPid=null,startTime=null,exitCode=null,confirmedEmpty=false,stopping=false,error=null,buf='',settled=false;
  let resolveReady,rejectReady,resolveDone;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  // A caller may cancel before awaiting ready.
  ready.catch(()=>{});
  const done=new Promise(resolve=>{resolveDone=resolve;});
  let startupTimer=null,stopTimer=null,deadlineTimer=null,doneSettled=false;
  const report=()=>({confirmedEmpty,exitCode,error,containment:'job',rootPid,startTime});
  function settleDone(){if(!doneSettled){doneSettled=true;resolveDone(report());}}
  function boundedStop(){if(!stopTimer){stopTimer=setTimeout(forceClose,6000);stopTimer.unref?.();}if(!deadlineTimer){deadlineTimer=setTimeout(()=>{confirmedEmpty=false;error=error||'job_empty_unconfirmed';settleDone();},8500);deadlineTimer.unref?.();}}
  function rejectStart(code) {
    if(!settled){settled=true;rejectReady(Error(code));}
  }
  function endControl(){
    try{child.stdin.end();}catch{}
  }
  function forceClose(){
    if(live(child)){try{child.kill();}catch{}}
  }
  function fail(code) {
    if(!error)error=code;
    rejectStart(code);state='failed';stopping=true;endControl();
    boundedStop();
  }
  function frame(line){
    let m;
    if((m=/^NXJOB PREPARED (\d+) ([1-9]\d{15,19})$/.exec(line))&&state==='starting'&&pidOk(Number(m[1]))){
      rootPid=Number(m[1]);startTime=m[2];state='prepared';
      if(stopping){endControl();return;}
      try{child.stdin.write('RUN\n');}catch{fail('job_control_failed');}
      return;
    }
    if((m=/^NXJOB READY (\d+) ([1-9]\d{15,19})$/.exec(line))&&state==='prepared'&&Number(m[1])===rootPid&&m[2]===startTime){
      state='ready';clearTimeout(startupTimer);
      if(!settled&&!stopping){settled=true;resolveReady({rootPid,startTime});}
      return;
    }
    if((m=/^NXJOB EMPTY (\d+)$/.exec(line))&&rootPid!==null&&Number(m[1])<=0xffffffff&&['prepared','ready'].includes(state)&&!error){
      confirmedEmpty=true;exitCode=Number(m[1]);state='empty';clearTimeout(startupTimer);
      rejectStart('job_ended_before_ready');endControl();return;
    }
    if((m=/^NXJOB ERROR ([a-z_]+) (\d+)$/.exec(line))){fail('job_'+m[1]);return;}
    fail('job_protocol_invalid');
  }
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data',chunk=>{
    buf+=chunk;
    if(buf.length>4096){fail('job_protocol_overflow');return;}
    let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).replace(/\r$/,'');buf=buf.slice(i+1);frame(line);}
  });
  child.stdin?.on('error',()=>{if(!stopping&&!confirmedEmpty)fail('job_control_failed');});
  child.once('error',()=>fail('job_helper_launch_failed'));
  // Wait for close (stderr flushed), not merely exit.
  child.once('close',(code)=>{
    clearTimeout(startupTimer);clearTimeout(stopTimer);clearTimeout(deadlineTimer);
    if(code!==0||error)confirmedEmpty=false;
    if(!confirmedEmpty&&!error)error='job_empty_unconfirmed';
    rejectStart(error||'job_ended_before_ready');state='closed';settleDone();
  });
  startupTimer=setTimeout(()=>fail('job_start_timeout'),10000);startupTimer.unref?.();
  return {
    child,ready,done,containment:'job',
    get rootPid(){return rootPid;},get startTime(){return startTime;},
    requestStop(){
      if(state==='closed'||state==='empty')return;
      stopping=true;rejectStart('job_cancelled');endControl();
      boundedStop();
    },
    async stop(){this.requestStop();return done;}
  };
}

// Non-Windows and explicitly injected test launchers retain a child handle.
// Never claim descendant containment or a verified empty tree on this path.
export function launchRetained(exe,args,options,spawnFn=spawn){
  const child=spawnFn(exe,args,options);
  let resolveReady,rejectReady,resolveDone,settled=false,ended=false,exitCode=null,error=null;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  ready.catch(()=>{});
  const done=new Promise(resolve=>{resolveDone=resolve;});
  const finish=(code,err)=>{
    if(ended)return;ended=true;exitCode=code;error=err;
    if(!settled){settled=true;rejectReady(Error(err||'child_ended_before_ready'));}
    resolveDone({confirmedEmpty:false,rootExited:true,exitCode,error,containment:'root_only',descendantsMayRemain:true});
  };
  child.once('spawn',()=>{if(!settled){settled=true;resolveReady({rootPid:child.pid});}});
  child.once('exit',code=>finish(code,null));
  child.once('error',()=>finish(null,'child_launch_failed'));
  return {child,ready,done,containment:'root_only',get rootPid(){return child.pid;},
    requestStop(){if(!ended&&live(child)){try{child.kill();}catch{}}},async stop(){this.requestStop();return done;}};
}

export function launchForPlatform(mode,exe,args,options,{platform=process.platform,spawnFn=spawn}={}){
  // Existing injection points are synthetic; a production Windows launch is
  // always contained, never silently retried as a normal launch.
  return platform==='win32'&&spawnFn===spawn?launchContained(mode,exe,args,options):
    launchRetained(exe,args,options,spawnFn);
}
