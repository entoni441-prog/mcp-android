import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runManifest } from './controller.mjs';
const THREAD_ID = '12345678-1234-4234-8234-123456789abc';
const exec = promisify(execFile);
const script = fileURLToPath(new URL('./fake-codex.mjs',import.meta.url));
const controller = new URL('./controller.mjs',import.meta.url).href;
const digest = crypto.createHash('sha256').update(await fs.readFile(process.execPath)).digest('hex');
async function fixture(t,mode='success') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'nexus-resume-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const work = path.join(root,'repo'), state = path.join(root,'state'), owner = path.join(root,'owner');
  await Promise.all([work,state,owner].map(p => fs.mkdir(p)));
  await exec('git',['init','-b','isolated-test'],{cwd:work});
  await fs.writeFile(path.join(work,'.gitignore'),'mock.json\n');
  // A local empty index is enough; no commit is made, even in fixtures.
  await fs.rm(path.join(work,'.gitignore'));
  await fs.writeFile(path.join(work,'.git','info','exclude'),'mock.json\n');
  await fs.writeFile(path.join(work,'mock.json'),JSON.stringify({stateDirectory:state,taskId:'test-task',mode}));
  const m = {taskId:'test-task',approved:true,workingDirectory:work,codexExe:process.execPath,codexSha256:digest,expectedBranch:'isolated-test',stateDirectory:state,initialPrompt:'CANARY_SECRET',resumePrompt:'CANARY_SECRET',maxResumes:1,completionFile:path.join(state,'complete.json')};
  const opts = {testScript:script,ownerDirectory:owner,timeoutMs:4000};
  return {root,work,state,owner,m,opts,run:() => runManifest(m,opts)};
}
async function waitFile(file) {
  for (let i=0;i<200;i++) { try { return JSON.parse(await fs.readFile(file,'utf8')); } catch {} await new Promise(r=>setTimeout(r,25)); }
  throw new Error('checkpoint timeout');
}

test('successful no-crash completion; terminal claim rejects another owner',async t=>{
  const f=await fixture(t); assert.equal((await f.run()).status,'COMPLETED');
  assert.equal((await f.run()).reason,'ALREADY_CLAIMED');
  f.m.taskId='another-owner'; assert.equal((await f.run()).reason,'ALREADY_CLAIMED');
  const output=await fs.readFile(path.join(f.state,'state.json'),'utf8');
  assert.ok(!output.includes('CANARY_SECRET'));
});
test('external exact child PID kill triggers same-thread automatic resume and one effect',async t=>{
  const f=await fixture(t,'hold');
  const code=`import {runManifest} from ${JSON.stringify(controller)}; console.log(JSON.stringify(await runManifest(${JSON.stringify(f.m)},${JSON.stringify(f.opts)})));`;
  const supervisor=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output=''; supervisor.stdout.on('data',b=>output+=b); supervisor.stderr.on('data',()=>{});
  const done=new Promise(r=>supervisor.once('close',r));
  let childPid;
  t.after(()=>{ if(childPid) { try { process.kill(childPid,'SIGKILL'); } catch {} } if(supervisor.exitCode===null) supervisor.kill('SIGKILL'); });
  const checkpoint=await waitFile(path.join(f.state,'checkpoint.json'));
  const state=await waitFile(path.join(f.state,'state.json'));
  childPid=checkpoint.pid;
  assert.equal(childPid,state.childPid); assert.notEqual(childPid,supervisor.pid);
  assert.equal(checkpoint.threadId,THREAD_ID);
  process.kill(childPid,'SIGKILL'); childPid=null;
  assert.equal(await done,0);
  const result=JSON.parse(output.trim());
  assert.equal(result.status,'COMPLETED'); assert.equal(result.attempt,1);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.state,'resumed.json'),'utf8')).threadId,THREAD_ID);
  assert.equal(await fs.readFile(path.join(f.state,'effect-once.txt'),'utf8'),'effect\n');
  assert.ok(!output.includes('CANARY_SECRET'));
  assert.ok(!(await fs.readFile(path.join(f.state,'state.json'),'utf8')).includes('CANARY_SECRET'));
});
for(const [mode,reason] of [['missing','MISSING_THREAD'],['exhaust','RESUMES_EXHAUSTED'],['bad','BAD_EVENTS'],['turn-failed','TURN_FAILED'],['turn-completed','COMPLETION_UNCONFIRMED']]) test(mode,async t=>{const f=await fixture(t,mode); assert.equal((await f.run()).reason,reason);});
test('valid completion despite nonzero exit prevents duplicate',async t=>{const f=await fixture(t,'ambiguous'); const r=await f.run(); assert.equal(r.status,'COMPLETED'); assert.equal(r.attempt,0);});
for(const [name,change,reason] of [
  ['unapproved',m=>m.approved=false,'MANIFEST_SCHEMA'],
  ['extra field',m=>m.bypass=true,'MANIFEST_SCHEMA'],
  ['hash mismatch',m=>m.codexSha256='0'.repeat(64),'CLI_HASH'],
  ['wrong branch',m=>m.expectedBranch='main','WRONG_BRANCH'],
  ['path overlap',m=>m.stateDirectory=m.workingDirectory,'PATH_OVERLAP'],
  ['resume budget',m=>m.maxResumes=2,'MANIFEST_SCHEMA']
]) test(name,async t=>{const f=await fixture(t); change(f.m); assert.equal((await f.run()).reason,reason);});
test('owner stop before spawn',async t=>{const f=await fixture(t); await fs.writeFile(path.join(f.owner,'owner-stop.json'),'{}'); assert.equal((await f.run()).reason,'OWNER_STOP'); assert.equal(await fs.readdir(f.state).then(a=>a.includes('checkpoint.json')),false);});
test('dirty repository stops',async t=>{const f=await fixture(t); await fs.writeFile(path.join(f.work,'unrelated'),'x'); assert.equal((await f.run()).reason,'DIRTY_WORKTREE');});
test('timeout stops without killing live child',async t=>{
  const f=await fixture(t,'hold'); f.opts.timeoutMs=200;
  const result=await f.run();
  assert.equal(result.reason,'TIMEOUT_CHILD_MAY_BE_ALIVE');
  const cp=await waitFile(path.join(f.state,'checkpoint.json'));
  assert.equal(cp.pid,result.childPid);
  process.kill(cp.pid,0);
  // Only this fixture's exact recorded child is cleaned up.
  process.kill(cp.pid,'SIGKILL');
  await new Promise(r=>setTimeout(r,100));
});
test('owner pause during run stops without resume or killing child',async t=>{
  const f=await fixture(t,'hold');
  const running=f.run();
  const cp=await waitFile(path.join(f.state,'checkpoint.json'));
  t.after(()=>{try{process.kill(cp.pid,'SIGKILL');}catch{}});
  await fs.writeFile(path.join(f.owner,'host-off'),'');
  const result=await running;
  assert.equal(result.childPid,cp.pid); assert.equal(result.reason,'OWNER_STOP'); assert.equal(result.attempt,0);
  process.kill(cp.pid,0); process.kill(cp.pid,'SIGKILL');
  await new Promise(r=>setTimeout(r,100));
});
test('preexisting valid marker completes without spawning',async t=>{
  const f=await fixture(t);
  await fs.writeFile(f.m.completionFile,JSON.stringify({taskId:f.m.taskId,status:'completed'}));
  const r=await f.run(); assert.equal(r.status,'COMPLETED'); assert.equal(r.childPid,null);
});
