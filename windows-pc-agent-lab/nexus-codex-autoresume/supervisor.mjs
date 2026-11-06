import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fork} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {validate} from './controller.mjs';
import {atomic,identity,exited,digest} from './lifecycle.mjs';
export async function supervise(file,options={}){
 let state, destination, activeController;
 const save=async(status,reason)=>{state={...state,status,reason};await atomic(destination,state);return {status,reason};};
 try{
 const m=await validate(JSON.parse(await fs.readFile(file,'utf8')));
 destination=path.join(m.stateDirectory,'supervisor.json');
 const claim={taskId:m.taskId,manifestDigest:digest(m),token:crypto.randomUUID(),identity:await identity(process.pid)};
 const h=await fs.open(path.join(m.stateDirectory,'supervisor-owner.json'),'wx',0o600).catch(()=>{throw Error('ALREADY_SUPERVISED')});
 try{await h.writeFile(JSON.stringify(claim));await h.sync();}finally{await h.close();}
 state={taskId:m.taskId,manifestDigest:claim.manifestDigest};await save('STOP','SUPERVISOR_INTERRUPTED');
 const deadline=Date.now()+(options.deadlineMs??600000);
 const launch=async mode=>{
 const child=fork(fileURLToPath(new URL('./controller.mjs',import.meta.url)),[mode,file],{silent:true,windowsHide:true});
 activeController=child;
 const death=new Promise(resolve=>{child.once('error',()=>resolve({code:1}));child.once('exit',(code,signal)=>resolve({code,signal}));});
 child.stdout.resume();child.stderr.resume();
 state.controllerIdentity=await identity(child.pid);await save('STOP','CONTROLLER_ACTIVE');
 child.send({...options.controllerOptions,supervised:{token:claim.token}},()=>{});
 let timeExpired=false;
 const timer=setTimeout(()=>{timeExpired=true;if(child.exitCode===null&&child.signalCode===null)try{child.kill('SIGTERM');}catch{}},Math.max(1,deadline-Date.now()));
 const result=await death;activeController=null;clearTimeout(timer);return {...result,timeExpired};
 };
 const first=await launch('run');
 let current=JSON.parse(await fs.readFile(path.join(m.stateDirectory,'state.json'),'utf8'));
 if(current.taskId!==m.taskId||current.manifestDigest!==claim.manifestDigest)throw Error('FOREIGN_STATE');
 if(current.status==='COMPLETED')return await save('COMPLETED','COMPLETION_MARKER');
 if(first.timeExpired)return await save('STOP','DEADLINE');
 if(current.status==='STOP')return await save('STOP',current.reason??'CONTROLLER_EXIT');
 if(JSON.stringify(current.controllerIdentity)!==JSON.stringify(state.controllerIdentity))throw Error('FOREIGN_STATE');
 if(!await exited(state.controllerIdentity))throw Error('PROCESS_UNCERTAIN');
 while(!await exited(current.childIdentity)){
 if(Date.now()>=deadline) return await save('STOP','ORPHAN_TIMEOUT');
 await new Promise(r=>setTimeout(r,100));
 }
 if(Date.now()>=deadline)return await save('STOP','DEADLINE');
 let marker=false;
 try{const st=await fs.lstat(m.completionFile);if(!st.isFile()||st.isSymbolicLink()||st.size>1024)throw Error();const v=JSON.parse(await fs.readFile(m.completionFile,'utf8'));if(v.taskId!==m.taskId||v.status!=='completed')throw Error();marker=true;}catch(e){if(e.code!=='ENOENT')return await save('STOP','INVALID_MARKER');}
 if(!marker){
   if(!['RUNNING','RECOVERING'].includes(current.status)||current.eventUnsafe||current.recordedStatus)return await save('STOP','RECOVERY_UNSAFE');
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(current.threadId??''))return await save('STOP','MISSING_THREAD');
   if(current.attempt!==0)return await save('STOP','RESUMES_EXHAUSTED');
 }

 if(digest(JSON.parse(await fs.readFile(file,'utf8')))!==claim.manifestDigest)throw Error('MANIFEST_CHANGED');
 if(deadline-Date.now()<2000)return await save('STOP','DEADLINE');
 const second=await launch('recover');
 if(second.timeExpired)return await save('STOP','DEADLINE');
 current=JSON.parse(await fs.readFile(path.join(m.stateDirectory,'state.json'),'utf8'));
 return await save(current.status==='COMPLETED'?'COMPLETED':'STOP',current.reason);
 }catch(e){if(activeController && activeController.exitCode===null && activeController.signalCode===null){try{activeController.kill();}catch{}activeController.stdout.destroy();activeController.stderr.destroy();activeController.unref();}const reason=['ALREADY_SUPERVISED','PROCESS_UNCERTAIN','FOREIGN_STATE','MANIFEST_CHANGED'].includes(e.message)?e.message:'SUPERVISOR_UNCERTAIN';if(state)return await save('STOP',reason);return {status:'STOP',reason};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let r;if(process.argv.length!==4||process.argv[2]!=='run')r={status:'STOP',reason:'USAGE'};else r=await supervise(process.argv[3]);console.log(JSON.stringify(r));if(r.status!=='COMPLETED')process.exitCode=1;}
