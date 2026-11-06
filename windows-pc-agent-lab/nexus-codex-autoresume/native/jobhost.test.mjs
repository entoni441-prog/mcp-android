// Windows-only acceptance of REAL kernel Job Object ownership and singleton.
// Each case is a new OS Temp sandbox. Never touches NEXUS production.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const exec=promisify(execFile);
const here=path.dirname(fileURLToPath(import.meta.url));
const parent=path.resolve(here,'GuardianJobHost.cs');
const fixtureScript=path.join(here,'job-fixture.mjs');
const snooze=ms=>new Promise(r=>setTimeout(r,ms));
let runner,buildDir;
const hostAvailable=process.platform==='win32';
test.before(async()=>{
  if(!hostAvailable)return;
  // Reuse a separately compiled, verified native runner when available.
  // Some managed Windows machines disallow immediate execution of a newly
  // created unsigned EXE from the Node test's temporary build directory.
  const prebuilt=process.env.NEXUS_JOBHOST_EXE || path.join(os.tmpdir(),'nexus-guardian-jobhost-20261106.exe');
  if(await fs.access(prebuilt).then(()=>true,()=>false)){runner=prebuilt;return;}
  const cscPaths=[
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
  ];
  const csc=(await Promise.all(cscPaths.map(async p=>({p,ok:await fs.access(p).then(()=>true,()=>false)})))).find(x=>x.ok)?.p;
  if(!csc)throw Error('NO_WINDOWS_CSC_COMPILER');
  buildDir=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-job-build-'));
  runner=path.join(buildDir,'GuardianJobHost.exe');
  await exec(csc,['/nologo','/target:exe','/r:System.Core.dll','/out:'+runner,parent],{timeout:30000});
});
test.after(async()=>{if(buildDir)await fs.rm(buildDir,{recursive:true,force:true});});
async function sandbox(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-job-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return dir;
}
function start(id,dir,mode,heartbeat=2200,limit=18000){
  const args=['run',id,process.execPath,fixtureScript,dir,mode,String(heartbeat),String(limit)];
  const child=spawn(runner,args,{cwd:here,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='';
  child.stdout.on('data',c=>{out+=c.toString();});
  child.stderr.on('data',c=>{err+=c.toString();});
  const death=new Promise(resolve=>{
    child.once('error',e=>resolve({error:String(e)}));
    child.once('close',(code,signal)=>resolve({code,signal}));
  });
  return {child,death,getOutput:()=>({out,err})};
}
async function result(proc,ms=15000) {
  const v=await Promise.race([proc.death,snooze(ms).then(()=>({timeout:true}))]);
  if(v.timeout){proc.child.kill();throw Error('NATIVE_RUNNER_TIMEOUT');}
  return {...v,...proc.getOutput()};
}
async function read(pathname){
  return JSON.parse(await fs.readFile(pathname,'utf8'));
}
async function until(file,valid=()=>true,ms=5000){
  const end=Date.now()+ms;
  while(Date.now()<end){
    try{const r=await read(file);if(valid(r))return r;}catch{}
    await snooze(35);
  }
  throw Error('WAIT_FOR_TEST_FILE_TIMEOUT:'+path.basename(file));
}
function alive(pid){
  try{process.kill(pid,0);return true;}catch{return false;}
}
async function waitGone(pid,ms=4000){
  const end=Date.now()+ms;
  while(Date.now()<end){if(!alive(pid))return true;await snooze(50);}
  return !alive(pid);
}
async function effectHash(dir){
  return crypto.createHash('sha256').update(await fs.readFile(path.join(dir,'effect-once.txt'))).digest('hex');
}
function supported(t){if(!hostAvailable){t.skip('native Job Objects require Windows');return false;}return true;}

test('normal completion leaves Job empty and exact effect once',{timeout:20000},async t=>{
  if(!supported(t))return;
  const dir=await sandbox(t),p=start('normal-'+crypto.randomUUID().slice(0,8),dir,'normal');
  const res=await result(p);
  assert.equal(res.code,0);
  const status=await read(path.join(dir,'job-host-status.json'));
  assert.equal(status.status,'COMPLETED');
  assert.equal(status.jobActive,0);
  assert.equal(await waitGone(status.childPid),true);
  assert.equal((await fs.readdir(dir)).filter(x=>x==='effect-once.txt').length,1);
});

test('parallel second owner is rejected by kernel mutex; original remains alive',{timeout:30000},async t=>{
  if(!supported(t))return;
  const dir=await sandbox(t),id='single-'+crypto.randomUUID().slice(0,8);
  const first=start(id,dir,'hold',3000,22000);
  let pid;
  try{
    const state=await until(path.join(dir,'job-host-status.json'),s=>s.status==='RUNNING');
    await until(path.join(dir,'fixture-status.json'),s=>s.ready===true&&s.pid===state.childPid);
    pid=state.childPid;
    assert.ok(alive(state.ownerPid)&&alive(state.childPid));
    const second=start(id,dir,'hold',3000,22000);
    const duplicate=await result(second,5000);
    assert.equal(duplicate.code,12);
    assert.match(duplicate.out,/DUPLICATE_OWNER/);
    assert.ok(alive(state.ownerPid)&&alive(state.childPid));
    assert.equal((await fs.readdir(dir)).filter(x=>x==='effect-once.txt').length,1);
  }finally{
    first.child.kill('SIGKILL');
    await result(first,4000);
    if(pid)assert.equal(await waitGone(pid),true);
  }
});

test('ALIVE but heartbeat-stale worker and detached grandchild are killed together',{timeout:20000},async t=>{
  if(!supported(t))return;
  const dir=await sandbox(t),p=start('hang-'+crypto.randomUUID().slice(0,8),dir,'hang',2300,16000);
  const res=await result(p);
  assert.equal(res.code,20);
  assert.match(res.out,/HEARTBEAT_STALE/);
  const st=await read(path.join(dir,'job-host-status.json'));
  const gc=await read(path.join(dir,'grandchild-ready.json'));
  assert.equal(st.reason,'HEARTBEAT_STALE_JOB_EMPTY');
  assert.equal(st.jobActive,0);
  assert.equal(await waitGone(st.childPid),true);
  assert.equal(await waitGone(gc.pid),true);
  assert.equal((await fs.readdir(dir)).filter(x=>x==='effect-once.txt').length,1);
});

test('SIGKILL of exact kernel Job owner automatically kills detached grandchild',{timeout:25000},async t=>{
  if(!supported(t))return;
  const dir=await sandbox(t),p=start('crash-'+crypto.randomUUID().slice(0,8),dir,'hang',12000,30000);
  let main,gc;
  try{
    const state=await until(path.join(dir,'job-host-status.json'),s=>s.status==='RUNNING');
    main=state.childPid;
    gc=(await until(path.join(dir,'grandchild-ready.json'))).pid;
    assert.ok(alive(state.ownerPid)&&alive(main)&&alive(gc));
    const hashBefore=await effectHash(dir);
    p.child.kill('SIGKILL'); // exactly THIS ChildProcess handle, not a discovered PID.
    await result(p,4000);
    assert.equal(await waitGone(main),true);
    assert.equal(await waitGone(gc),true);
    assert.equal(await effectHash(dir),hashBefore);
  }finally{if(p.child.exitCode===null)p.child.kill('SIGKILL');}
});

test('detached grandchild is removed when parent exits normally',{timeout:20000},async t=>{
  if(!supported(t))return;
  const dir=await sandbox(t),p=start('tree-'+crypto.randomUUID().slice(0,8),dir,'tree');
  const res=await result(p);
  assert.equal(res.code,0);
  const state=await read(path.join(dir,'job-host-status.json'));
  const grandchild=await read(path.join(dir,'grandchild-ready.json'));
  assert.equal(state.jobActive,0);
  assert.equal(await waitGone(grandchild.pid),true);
});

test('OS mutex is released after owner crash, without reusing a task state directory',{timeout:25000},async t=>{
  if(!supported(t))return;
  const original=await sandbox(t),newState=await sandbox(t);
  const taskId='release-'+crypto.randomUUID().slice(0,8);
  const first=start(taskId,original,'hold',3000,20000);
  let oldPid;
  try{
    const st=await until(path.join(original,'job-host-status.json'),x=>x.status==='RUNNING');
    await until(path.join(original,'fixture-status.json'),x=>x.ready===true&&x.pid===st.childPid);
    oldPid=st.childPid;
    assert.ok(alive(st.ownerPid));
    first.child.kill('SIGKILL');
    await result(first,4000);
    assert.equal(await waitGone(oldPid),true);
    // Different test state directory deliberately: previous task receipts are
    // immutable; this proves OS ownership release, not task replay.
    const next=start(taskId,newState,'normal',3000,8000);
    const resumed=await result(next,6000);
    assert.equal(resumed.code,0);
    const newStatus=await read(path.join(newState,'job-host-status.json'));
    assert.equal(newStatus.status,'COMPLETED');
    assert.equal(newStatus.jobActive,0);
    assert.equal((await fs.readdir(original)).filter(x=>x==='effect-once.txt').length,1);
    assert.equal((await fs.readdir(newState)).filter(x=>x==='effect-once.txt').length,1);
  }finally{
    if(first.child.exitCode===null)first.child.kill('SIGKILL');
    if(oldPid)assert.equal(await waitGone(oldPid),true);
  }
});
test('non-fixture executable arguments are rejected before any process is started',{timeout:10000},async t=>{
  if(!supported(t))return;
  const dir=await sandbox(t);
  const args=['run','reject-'+crypto.randomUUID().slice(0,8),process.execPath,
    path.join(here,'job-grandchild.mjs'),dir,'normal','2500','9000'];
  const p=spawn(runner,args,{cwd:here,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='';
  p.stdout.on('data',c=>stdout+=c.toString());
  const close=await new Promise(resolve=>p.once('close',code=>resolve(code)));
  assert.equal(close,64);
  assert.match(stdout,/INVALID_TEST_ARGS/);
  assert.deepEqual(await fs.readdir(dir),[]);
});
