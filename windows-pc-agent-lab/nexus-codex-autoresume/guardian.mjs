import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {StringDecoder} from 'node:string_decoder';
import {validate,runManifest} from './controller.mjs';

const exec=promisify(execFile);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const exists=async f=>{try{await fs.stat(f);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const digest=async f=>crypto.createHash('sha256').update(await fs.readFile(f)).digest('hex');
const ownStop=async dir=>await exists(path.join(dir,'owner-stop.json'))||await exists(path.join(dir,'host-off'));

async function atomic(file,value) {
  const temp=file+'.'+crypto.randomUUID()+'.tmp';
  const h=await fs.open(temp,'wx',0o600);
  try{await h.writeFile(JSON.stringify(value));await h.sync();}finally{await h.close();}
  await fs.rename(temp,file);
  try{const d=await fs.open(path.dirname(file),'r');try{await d.sync();}finally{await d.close();}}catch{}
}
async function markerOk(m) {
  try{
    const s=await fs.lstat(m.completionFile);
    if(!s.isFile()||s.isSymbolicLink()||s.size>1024)return false;
    const data=JSON.parse(await fs.readFile(m.completionFile,'utf8'));
    return data.taskId===m.taskId&&data.status==='completed';
  }catch{return false;}
}
async function verifyGuards(m,ownerDir) {
  if(await ownStop(ownerDir))return 'OWNER_STOP';
  if(await digest(m.codexExe)!==m.codexSha256)return 'CLI_HASH';
  const branch=(await exec('git',['branch','--show-current'],{cwd:m.workingDirectory,timeout:10000,windowsHide:true})).stdout.trim();
  if(branch!==m.expectedBranch)return 'WRONG_BRANCH';
  const dirty=(await exec('git',['status','--porcelain','--untracked-files=all'],{cwd:m.workingDirectory,timeout:10000,windowsHide:true})).stdout.split(/\r?\n/).filter(Boolean);
  if(dirty.some(line=>! /^\?\? windows-pc-agent-lab\/nexus-codex-autoresume\//.test(line)))return 'DIRTY_WORKTREE';
  return null;
}
function gone(pid) {
  try{process.kill(pid,0);return false;}catch(e){return e.code==='ESRCH';}
}
async function waitForGone(pid,ownerDir,ms) {
  const deadline=Date.now()+ms;
  do {
    if(await ownStop(ownerDir))return 'OWNER_STOP';
    if(gone(pid))return null;
    await sleep(100);
  }while(Date.now()<deadline);
  return 'ORPHAN_OR_PID_REUSED';
}
async function stopOwnedChild(child,death) {
  try{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');}catch{}
  const closed=await Promise.race([death.then(()=>true),sleep(1500).then(()=>false)]);
  child.stdout.destroy();child.stderr.destroy();child.unref();
  return closed;
}
async function uniqueClaim(file,data) {
  const h=await fs.open(file,'wx',0o600);
  try{await h.writeFile(JSON.stringify(data));await h.sync();}finally{await h.close();}
}

/*
 * Guardian supervises ONE controller it spawned. On unexpected controller death it
 * never re-runs the initial prompt, never removes owner.json and never kills a
 * discovered PID. Recovery requires an observed controller close, a saved exact
 * thread ID, a terminally absent CLI PID and a one-time durable rescue claim.
 */
export async function runGuardian(input,options={}) {
  let m;
  try{m=await validate(input);}catch{return {status:'STOP',reason:'MANIFEST_INVALID'};}
  const ownerDir=options.ownerDirectory??path.join(os.homedir(),'.nexus-host');
  const resultFile=path.join(m.stateDirectory,'guardian-result.json');
  const stateFile=path.join(m.stateDirectory,'state.json');
  const summary=async(status,reason,extra={})=>{
    const out={taskId:m.taskId,status,reason,...extra};
    try{await atomic(resultFile,out);}catch{return {taskId:m.taskId,status:'STOP',reason:'RESULT_IO_ERROR'};}
    return out;
  };
  try {
    const guard=await verifyGuards(m,ownerDir);
    if(guard)return await summary('STOP',guard);
    await uniqueClaim(path.join(m.stateDirectory,'guardian-claim.json'),{taskId:m.taskId});
  }catch{return {taskId:m.taskId,status:'STOP',reason:'ALREADY_GUARDED_OR_IO_ERROR'};}

  let control;
  try {
    const script=fileURLToPath(new URL('./controller.mjs',import.meta.url));
    const args=options.testScript
      ? ['--input-type=module','-e','import {runManifest} from '+JSON.stringify(pathToFileURL(script).href)+'; await runManifest('+JSON.stringify(m)+','+JSON.stringify({testScript:options.testScript,ownerDirectory:ownerDir,timeoutMs:options.initialTimeoutMs??10000})+');']
      : [script,'run',options.manifestPath];
    if(!options.testScript && (!options.manifestPath||!path.isAbsolute(options.manifestPath)))return await summary('STOP','MANIFEST_FILE_REQUIRED');
    control=spawn(process.execPath,args,{cwd:m.workingDirectory,stdio:['ignore','ignore','ignore'],windowsHide:true});
    const death=await new Promise(resolve=>{
      control.once('error',()=>resolve({error:true}));
      control.once('close',(code,signal)=>resolve({code,signal}));
    });
    // The live controller has finished: do not intervene if it produced a
    // terminal STOP. A valid marker, even across a lost ACK, is authoritative.
    let state;
    try{state=JSON.parse(await fs.readFile(stateFile,'utf8'));}catch{return await summary('STOP','STATE_UNREADABLE');}
    if(state.taskId!==m.taskId)return await summary('STOP','STATE_TASK_MISMATCH');
    if(await markerOk(m)) {
      if(state.status!=='COMPLETED')await atomic(stateFile,{...state,status:'COMPLETED',reason:'COMPLETION_MARKER',updatedAt:new Date().toISOString()});
      return await summary('COMPLETED','COMPLETION_MARKER',{attempt:state.attempt});
    }
    if(state.status==='STOP')return await summary('STOP',state.reason??'CONTROLLER_STOP');
    if(death.error||death.code===0)return await summary('STOP','CONTROLLER_EXIT_AMBIGUOUS');
    if(state.status!=='RUNNING'||state.attempt!==0||!UUID.test(state.threadId??'')||
       !Number.isSafeInteger(state.childPid)||state.childPid<1||
       state.recordedStatus!==null)return await summary('STOP','RESCUE_STATE_UNSAFE');
    if(await ownStop(ownerDir))return await summary('STOP','OWNER_STOP');

    const orphan=await waitForGone(state.childPid,ownerDir,options.orphanWaitMs??5000);
    if(orphan)return await summary('STOP',orphan);
    const guardAgain=await verifyGuards(m,ownerDir);
    if(guardAgain)return await summary('STOP',guardAgain);
    if(await markerOk(m))return await summary('COMPLETED','COMPLETION_MARKER',{attempt:0});

    // Durable single-use fence is written before any resumed process can run.
    try{await uniqueClaim(path.join(m.stateDirectory,'guardian-resume-claim.json'),{taskId:m.taskId,threadId:state.threadId});}
    catch{return await summary('STOP','RESCUE_ALREADY_CLAIMED');}
    const next={...state,attempt:1,status:'RECOVERING',reason:'GUARDIAN_RESUME_ARMED',childPid:null,updatedAt:new Date().toISOString()};
    await atomic(stateFile,next);

    const args=[...(options.testScript?[options.testScript]:[]),'exec','resume','--json',next.threadId,m.resumePrompt];
    const child=spawn(m.codexExe,args,{cwd:m.workingDirectory,stdio:['ignore','pipe','pipe'],windowsHide:true});
    const deathResume=new Promise(resolve=>{
      child.once('error',()=>resolve({error:true}));
      child.once('close',(code,signal)=>resolve({code,signal}));
    });
    await atomic(stateFile,{...next,childPid:child.pid??null,updatedAt:new Date().toISOString()});
    let buffer='',bad=false,turn=null;
    const decoder=new StringDecoder('utf8');
    child.stderr.on('data',()=>{});
    function parse(line){
      try{
        const e=JSON.parse(line);
        if(e.type==='turn.failed')turn='failed';
        if(e.type==='turn.completed')turn='completed';
        if(e.type==='thread.started'&&e.thread_id!==next.threadId)bad=true;
      }catch{bad=true;}
    }
    child.stdout.on('data',chunk=>{
      buffer+=decoder.write(chunk);
      if(buffer.length>65536){bad=true;buffer='';return;}
      let i;
      while((i=buffer.indexOf('\n'))>=0){parse(buffer.slice(0,i));buffer=buffer.slice(i+1);}
    });
    let timer;
    const cut=new Promise(resolve=>{
      const start=Date.now();
      timer=setInterval(async()=>{
        try{
          const stopped=await ownStop(ownerDir);
          if(stopped||Date.now()-start>=(options.resumeTimeoutMs??300000))resolve({boundary:stopped?'OWNER_STOP':'TIMEOUT'});
        }catch{resolve({boundary:'OWNER_STOP'});}
      },50);
    });
    const exit=await Promise.race([deathResume,cut]);
    clearInterval(timer);
    if(exit.boundary){
      const closed=await stopOwnedChild(child,deathResume);
      const reason=exit.boundary+'_'+(closed?'CHILD_TERMINATED':'CHILD_MAY_BE_ALIVE');
      await atomic(stateFile,{...next,childPid:child.pid??null,status:'STOP',reason,updatedAt:new Date().toISOString()});
      return await summary('STOP',reason,{attempt:1});
    }
    buffer+=decoder.end();
    if(buffer.trim())bad=true;
    if(await markerOk(m)){
      await atomic(stateFile,{...next,childPid:child.pid??null,status:'COMPLETED',reason:'COMPLETION_MARKER',updatedAt:new Date().toISOString()});
      return await summary('COMPLETED','COMPLETION_MARKER',{attempt:1});
    }
    const reason=(await ownStop(ownerDir))?'OWNER_STOP':
      bad?'BAD_EVENTS':exit.error?'SPAWN_FAILED':turn==='failed'?'TURN_FAILED':
      turn==='completed'?'COMPLETION_UNCONFIRMED':'RESUME_UNCONFIRMED';
    await atomic(stateFile,{...next,childPid:child.pid??null,status:'STOP',reason,updatedAt:new Date().toISOString()});
    return await summary('STOP',reason,{attempt:1});
  }catch{return await summary('STOP','GUARDIAN_IO_ERROR');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  let r;
  try{
    if(process.argv.length!==4||process.argv[2]!=='run')throw Error('USAGE');
    const manifest=path.resolve(process.argv[3]);
    r=await runGuardian(JSON.parse(await fs.readFile(manifest,'utf8')),{manifestPath:manifest});
  }catch{r={status:'STOP',reason:'INVALID_INPUT'};}
  console.log(JSON.stringify(r));
  if(r.status!=='COMPLETED')process.exitCode=1;
}
