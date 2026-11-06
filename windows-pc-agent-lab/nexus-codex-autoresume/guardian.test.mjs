import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {runGuardian} from './guardian.mjs';

const exec=promisify(execFile);
const here=path.dirname(fileURLToPath(import.meta.url));
const fake=path.join(here,'fake-codex.mjs');
const guardianUrl=new URL('./guardian.mjs',import.meta.url).href;
const thread='019a8f9b-1452-71c0-8a17-6915a0904d67';
const sha=crypto.createHash('sha256').update(await fs.readFile(process.execPath)).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function fixture(t,mode='hold'){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nx-guardian-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const repo=path.join(root,'repo'),state=path.join(root,'state'),owner=path.join(root,'owner');
  await Promise.all([repo,state,owner].map(x=>fs.mkdir(x)));
  await exec('git',['init','-b','isolated-test'],{cwd:repo});
  await fs.writeFile(path.join(repo,'.git','info','exclude'),'mock.json\n');
  await fs.writeFile(path.join(repo,'mock.json'),JSON.stringify({stateDirectory:state,taskId:'guardian-task',mode}));
  const m={taskId:'guardian-task',approved:true,workingDirectory:repo,codexExe:process.execPath,
    codexSha256:sha,expectedBranch:'isolated-test',stateDirectory:state,
    initialPrompt:'CANARY_SECRET',resumePrompt:'CANARY_SECRET',maxResumes:1,
    completionFile:path.join(state,'complete.json')};
  const options={testScript:fake,ownerDirectory:owner,initialTimeoutMs:25000,orphanWaitMs:1400,resumeTimeoutMs:8000};
  return {root,repo,state,owner,m,options};
}
async function waitJson(file,predicate=()=>true,timeout=18000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    try{const data=JSON.parse(await fs.readFile(file,'utf8'));if(predicate(data))return data;}catch{}
    await sleep(25);
  }
  throw new Error('waitJson_timeout: '+path.basename(file));
}
function launch(f) {
  const program='import {runGuardian} from '+JSON.stringify(guardianUrl)+
    '; console.log(JSON.stringify(await runGuardian('+JSON.stringify(f.m)+','+JSON.stringify(f.options)+')));';
  const p=spawn(process.execPath,['--input-type=module','-e',program],{
    cwd:f.repo,stdio:['ignore','pipe','pipe'],windowsHide:true
  });
  let out='',err='';
  p.stdout.on('data',b=>out+=b.toString());
  p.stderr.on('data',b=>err+=b.toString());
  const died=new Promise(resolve=>{
    p.once('close',(code,signal)=>resolve({code,signal}));
    p.once('error',error=>resolve({error:String(error)}));
  });
  return {p,died,read:()=>({out,err})};
}
function tryKill(pid){if(pid&&pid!==process.pid)try{process.kill(pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}}
async function ready(f) {
  const [saved,proc,cp]=await Promise.all([
    waitJson(path.join(f.state,'state.json'),x=>x.status==='RUNNING'&&typeof x.threadId==='string'),
    waitJson(path.join(f.state,'guardian-process.json'),x=>Number.isInteger(x.controllerPid)),
    waitJson(path.join(f.state,'checkpoint.json'),x=>Number.isInteger(x.pid))
  ]);
  assert.equal(saved.childPid,cp.pid);
  assert.equal(saved.threadId,thread);
  assert.notEqual(proc.controllerPid,cp.pid);
  return {controllerPid:proc.controllerPid,childPid:cp.pid};
}
async function waitResult(p) {
  const closed=await Promise.race([p.died,sleep(10000).then(()=>({timeout:true}))]);
  if(closed.timeout){tryKill(p.p.pid);throw new Error('guardian_timeout');}
  const {out,err}=p.read();
  assert.equal(err,'','stderr must remain sanitized');
  const row=out.trim().split('\n').filter(Boolean).at(-1);
  assert.ok(row,'missing guardian result');
  return {result:JSON.parse(row),code:closed.code};
}

test('normal controller completion needs no rescue; second launch rejected',async t=>{
  const f=await fixture(t,'success');
  const first=await runGuardian(f.m,f.options);
  assert.equal(first.status,'COMPLETED');
  assert.equal(first.attempt,0);
  assert.equal(await fs.access(path.join(f.state,'guardian-resume-claim.json')).then(()=>true,()=>false),false);
  const again=await runGuardian(f.m,f.options);
  assert.equal(again.status,'STOP');
  assert.equal(again.reason,'ALREADY_GUARDED_OR_IO_ERROR');
});
test('real controller SIGKILL then exact test-child exit resumes same thread once', {timeout:40000},async t=>{
  const f=await fixture(t);
  const p=launch(f);let ids;
  try {
    ids=await ready(f);
    const original=crypto.createHash('sha256').update(await fs.readFile(path.join(f.state,'effect-once.txt'))).digest('hex');
    tryKill(ids.controllerPid); // Only guardian-spawned controller.
    await sleep(120);
    tryKill(ids.childPid); // Exact mock child confirmed by checkpoint + state.
    const {result,code}=await waitResult(p);
    assert.equal(code,0);
    assert.equal(result.status,'COMPLETED');
    assert.equal(result.attempt,1);
    assert.equal(result.reason,'COMPLETION_MARKER');
    const resume=await waitJson(path.join(f.state,'resumed.json'));
    assert.equal(resume.threadId,thread);
    const after=crypto.createHash('sha256').update(await fs.readFile(path.join(f.state,'effect-once.txt'))).digest('hex');
    assert.equal(after,original,'side effect must not repeat');
    const state=await waitJson(path.join(f.state,'state.json'),x=>x.status==='COMPLETED');
    assert.equal(state.threadId,thread);
    assert.equal(state.attempt,1);
    assert.equal(await fs.access(path.join(f.state,'guardian-resume-claim.json')).then(()=>true,()=>false),true);
    assert.ok(!JSON.stringify(state).includes('CANARY_SECRET'));
    assert.ok(!JSON.stringify(result).includes('CANARY_SECRET'));
  }finally{if(ids)tryKill(ids.childPid);if(p.p.exitCode===null)tryKill(p.p.pid);}
});
test('live PID in recovered state: STOP, never terminate or retry unknown process', {timeout:40000},async t=>{
  const f=await fixture(t);f.options.orphanWaitMs=350;
  const p=launch(f);let ids;
  const sentinel=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
  try{
    ids=await ready(f);
    assert.ok(Number.isInteger(sentinel.pid));
    // Simulate an orphan or reused PID in the durable state. The sentinel is a
    // separate, test-created process; guardian must not signal or hijack it.
    const statePath=path.join(f.state,'state.json');
    const saved=await waitJson(statePath);
    await fs.writeFile(statePath,JSON.stringify({...saved,childPid:sentinel.pid}));
    tryKill(ids.controllerPid);
    const {result}=await waitResult(p);
    assert.equal(result.status,'STOP');
    assert.equal(result.reason,'ORPHAN_OR_PID_REUSED');
    assert.equal(await fs.access(path.join(f.state,'resumed.json')).then(()=>true,()=>false),false);
    assert.equal(await fs.access(path.join(f.state,'guardian-resume-claim.json')).then(()=>true,()=>false),false);
    assert.doesNotThrow(()=>process.kill(sentinel.pid,0),'guardian must leave sentinel alive');
  }finally{
    sentinel.kill('SIGKILL');
    if(ids)tryKill(ids.childPid);
    if(p.p.exitCode===null)tryKill(p.p.pid);
  }
});
test('owner STOP during controller crash forbids recovery', {timeout:40000},async t=>{
  const f=await fixture(t);const p=launch(f);let ids;
  try{
    ids=await ready(f);
    tryKill(ids.controllerPid);
    await fs.writeFile(path.join(f.owner,'owner-stop.json'),'{}');
    tryKill(ids.childPid);
    const {result}=await waitResult(p);
    assert.equal(result.status,'STOP');
    assert.equal(result.reason,'OWNER_STOP');
    assert.equal(await fs.access(path.join(f.state,'resumed.json')).then(()=>true,()=>false),false);
  }finally{if(ids)tryKill(ids.childPid);if(p.p.exitCode===null)tryKill(p.p.pid);}
});
test('dirty Git worktree after controller crash fails closed', {timeout:40000},async t=>{
  const f=await fixture(t);const p=launch(f);let ids;
  try{
    ids=await ready(f);
    tryKill(ids.controllerPid);
    await fs.writeFile(path.join(f.repo,'unrelated.txt'),'must block');
    tryKill(ids.childPid);
    const {result}=await waitResult(p);
    assert.equal(result.status,'STOP');
    assert.equal(result.reason,'DIRTY_WORKTREE');
    assert.equal(await fs.access(path.join(f.state,'resumed.json')).then(()=>true,()=>false),false);
  }finally{if(ids)tryKill(ids.childPid);if(p.p.exitCode===null)tryKill(p.p.pid);}
});
test('bad preflight SHA cannot launch controller',async t=>{
  const f=await fixture(t);f.m.codexSha256='f'.repeat(64);
  assert.equal((await runGuardian(f.m,f.options)).reason,'CLI_HASH');
  assert.equal(await fs.readdir(f.state).then(a=>a.includes('guardian-claim.json')),false);
});
test('ordinary controller STOP never triggers rescue',async t=>{
  const f=await fixture(t,'missing');
  const result=await runGuardian(f.m,f.options);
  assert.equal(result.status,'STOP');
  assert.equal(result.reason,'MISSING_THREAD');
  assert.equal(await fs.readdir(f.state).then(a=>a.includes('guardian-resume-claim.json')),false);
});
