import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {launchContained} from './job-containment.mjs';
import {createProcs} from './procs.mjs';
import {createBrowser} from './browser.mjs';
import {validateCapabilities} from './capabilities.mjs';
const A='638000000000000001';
function fakeJob(){
 const child=Object.assign(new EventEmitter(),{pid:700,exitCode:null,signalCode:null,killed:false,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(){throw Error('unexpected force close');}});
 let writes='';child.stdin.on('data',c=>writes+=c.toString());
 const frame=s=>child.stderr.write('NXJOB '+s+'\n');
 const end=(code=0)=>{child.exitCode=code;child.emit('exit',code);child.emit('close',code);};
 const start=()=>{frame('PREPARED 80 '+A);frame('READY 80 '+A);};
 const launch=()=>launchContained('task','C:\\Windows\\System32\\whoami.exe',[],{},{
  exists:()=>true,spawnFn:(exe,args,opts)=>{assert.match(exe,/NexusJobHost\.exe$/);assert.equal(opts.shell,false);assert.deepEqual(opts.stdio,['pipe','pipe','pipe']);return child;}
 });
 return {child,frame,end,start,launch,get writes(){return writes;}};
}
test('job handshake verifies PID and exact creation time; STOP waits for empty+close',async()=>{
 const f=fakeJob(),h=f.launch();
 f.start();assert.deepEqual(await h.ready,{rootPid:80,startTime:A});assert.equal(f.writes,'RUN\n');
 let done=false;const stop=h.stop().then(r=>{done=true;return r;});
 await Promise.resolve();assert.equal(done,false);assert.equal(f.child.stdin.writableEnded,true);
 f.frame('EMPTY 1');await Promise.resolve();assert.equal(done,false);
 f.end();const r=await stop;assert.equal(r.confirmedEmpty,true);assert.equal(r.containment,'job');assert.equal(r.exitCode,1);
});
test('job STOP before PREPARED never sends RUN',async()=>{
 const f=fakeJob(),h=f.launch();const stop=h.stop();f.frame('PREPARED 80 '+A);
 assert.equal(f.writes,'');await assert.rejects(h.ready,/job_cancelled/);
 f.frame('EMPTY 1');f.end();assert.equal((await stop).confirmedEmpty,true);
});
test('job wrong creation time and native launch failure are fail closed',async()=>{
 for(const mismatch of [true,false]){
  const f=fakeJob(),h=f.launch();
  if(mismatch){f.frame('PREPARED 80 '+A);f.frame('READY 80 638000000000000002');}
  else f.frame('ERROR create_contained 5');
  await assert.rejects(h.ready,mismatch?/job_protocol_invalid/:/job_create_contained/);
  f.end(121);assert.equal((await h.done).confirmedEmpty,false);
 }
});
test('job helper crash is not a verified empty job',async()=>{
 const f=fakeJob(),h=f.launch();f.start();await h.ready;f.end(1);
 const r=await h.done;assert.equal(r.confirmedEmpty,false);assert.equal(r.error,'job_empty_unconfirmed');
});
test('job missing helper refuses without launching anything',()=>{
 assert.throws(()=>launchContained('task','C:\\Windows\\System32\\whoami.exe',[],{},{
  exists:()=>false,spawnFn:()=>assert.fail('spawned')
 }),/job_helper_unavailable/);
});
test('job task cancel, session STOP and host stop wait for entire simulated tree',async()=>{
 const handles=[],audit=[];
 const exe=process.platform==='win32'?path.join(process.env.SystemRoot,'System32','whoami.exe'):'/bin/echo';
 const p=createProcs({caps:validateCapabilities({run_task:true,tasks:{probe:{exe,args:[],timeoutSec:60}}}),
  cfg:{workspace:os.tmpdir(),auditFile:'unused'},platform:'win32',audit:e=>audit.push(e),
  readIdentity:async pid=>({pid,process:'whoami',startTime:A}),
  launch:()=>{const f=fakeJob(),h=f.launch();handles.push(f);f.child.stdin.once('end',()=>{f.frame('EMPTY 1');f.end();});queueMicrotask(()=>f.start());return h;}
 });
 const one=await p.run_task({task:'probe'});assert.equal(one.pid,80);
 assert.equal((await p.task_cancel({id:one.id})).termination.confirmedEmpty,true);
 const two=await p.run_task({task:'probe'});const r=await p.cancelSession('stop',{startedAt:0});assert.equal(r.cancelled[0].id,two.id);assert.equal(r.cleanupUnconfirmed,false);
 await p.run_task({task:'probe'});await p.stopAll();assert.equal(audit.filter(e=>e.event==='task_termination'&&e.confirmedEmpty).length,3);
});
test('job browser rejects legacy profile processes, never launches or kills them',async()=>{
 const b=createBrowser({caps:validateCapabilities({browser:true}),home:os.tmpdir(),platform:'win32',browserPath:'C:\\Program Files\\Edge\\msedge.exe',
 listPids:()=>[123,456],launch:()=>assert.fail('launch with unowned profile')});
 await assert.rejects(b.browser_open({url:'https://example.com'}),/browser_profile_busy_unowned/);
 assert.equal((await b.cleanupSession()).remaining,2);
});
test('job browser STOP pending startup closes retained job and never connects CDP',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'nxjob-browser-'));
 const f=fakeJob();let launchCalled;const launched=new Promise(r=>launchCalled=r);
 const b=createBrowser({caps:validateCapabilities({browser:true}),home,platform:'win32',browserPath:'C:\\Program Files\\Edge\\msedge.exe',
 listPids:()=>[],launch:()=>{const h=f.launch();launchCalled();return h;}});
 const nav=b.browser_open({url:'https://example.com'});nav.catch(()=>{});
 await Promise.race([launched,nav.then(()=>{throw Error('unexpected browser navigation');})]);const stop=b.cleanupSession();f.frame('PREPARED 80 '+A);f.frame('EMPTY 1');f.end();
 await assert.rejects(nav,/job_cancelled|browser_start_cancelled/);
 assert.equal(f.writes,'');const r=await stop;assert.equal(r.remaining,0);assert.equal(r.cleanupUnconfirmed,false);
});
test('job native source has atomic creation and handle allow-list, no PID attach or tree sweep',()=>{
 const s=fs.readFileSync(new URL('./NexusJobHost.cs',import.meta.url),'utf8');
 assert.match(s,/KILL_ON_JOB_CLOSE/);assert.match(s,/JOB_LIST = new IntPtr\(0x0002000d\)/);
 assert.match(s,/HANDLE_LIST = new IntPtr\(0x00020002\)/);
 assert.ok(s.indexOf('Require(UpdateProcThreadAttribute(attrs,0,JOB_LIST')<s.indexOf('Require(CreateProcessW(args[1]'));
 assert.ok(s.indexOf('Require(CreateProcessW(args[1]')<s.indexOf('Require(ResumeThread(pi.hThread)'));
 assert.match(s,/TerminateJobObject\(job,1\)/);assert.match(s,/while\(Active\(job\)!=0\)/);
 // Compiler/native runtime acceptance is a separate gated stage.
});

const compiler=process.platform==='win32'&&process.env.SystemRoot?path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319','csc.exe'):null;
test('job helper C# compiles to a disposable experiment artifact (never executed)',{skip:!compiler||!fs.existsSync(compiler)},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nxjob-compile-'));
 try {
  const source=new URL('./NexusJobHost.cs',import.meta.url);
  const target=path.join(dir,'NexusJobHost.exe');
  const result=spawnSync(compiler,['/nologo','/target:exe','/platform:x64','/out:'+target,fileURLToPath(source)],{encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(result.error,undefined);assert.equal(result.status,0,String(result.stdout)+' '+String(result.stderr));assert.ok(fs.statSync(target).size>0);
 } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('job owned process kill stops only its retained verified job, never a looked-up PID',async()=>{
 const f=fakeJob(),h=f.launch(),log=[];
 f.start();await h.ready;
 const p=createProcs({caps:validateCapabilities({process_control:true}),cfg:{workspace:os.tmpdir(),auditFile:'unused'},
 platform:'win32',systemRoot:'C:\\Windows',audit:e=>log.push(e),
 readIdentity:async pid=>({pid,process:'whoami',startTime:A}),
 exec:async(exe,args)=>{assert.match(exe,/tasklist\.exe$/i);return {code:0,out:'"whoami.exe","80","Console","1","10 K"'};}
 });
 assert.equal(await p.registerOwned(h.child,'job',h),true);
 f.child.stdin.once('end',()=>{f.frame('EMPTY 1');f.end();});
 const result=await p.process_action({pid:80,action:'kill'});
 assert.equal(result.termination.confirmedEmpty,true);
 assert.ok(log.some(e=>e.event==='process_job_stop'&&e.confirmedEmpty));
 await assert.rejects(p.process_action({pid:80,action:'kill'}),/process_not_allowed/);
});
