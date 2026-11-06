import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {supervise} from './supervisor.mjs';
import {identity,exited} from './lifecycle.mjs';
import {runManifest} from './controller.mjs';
const exec=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const script=fileURLToPath(new URL('./fake-codex.mjs',import.meta.url));
let capable=true;try{await identity(process.pid);}catch{capable=false;}
async function fixture(t,mode='success'){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'nx-supervisor-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const work=path.join(root,'repo'),state=path.join(root,'state'),owner=path.join(root,'owner');for(const p of [work,state,owner])await fs.mkdir(p);
 await exec('git',['init','-b','isolated-test'],{cwd:work});await fs.writeFile(path.join(work,'.git','info','exclude'),'mock.json\n');
 await fs.writeFile(path.join(work,'mock.json'),JSON.stringify({stateDirectory:state,taskId:'test-task',mode}));
 const m={taskId:'test-task',approved:true,workingDirectory:work,codexExe:process.execPath,codexSha256:crypto.createHash('sha256').update(await fs.readFile(process.execPath)).digest('hex'),expectedBranch:'isolated-test',stateDirectory:state,initialPrompt:'CANARY_SECRET',resumePrompt:'CANARY_SECRET',maxResumes:1,completionFile:path.join(state,'complete.json')};
 const file=path.join(root,'manifest.json');await fs.writeFile(file,JSON.stringify(m));
 const options={deadlineMs:45000,controllerOptions:{testScript:script,ownerDirectory:owner,timeoutMs:30000}};
 return {root,work,state,owner,m,file,options};
}
async function waitState(f,predicate){for(let i=0;i<1200;i++){try{const s=JSON.parse(await fs.readFile(path.join(f.state,'state.json'),'utf8'));if(predicate(s))return s;}catch{}await sleep(25);}throw Error('checkpoint timeout');}
test('identity access denied produces explicit safe STOP and no launch', {skip:capable},async t=>{const f=await fixture(t);assert.deepEqual(await supervise(f.file,f.options),{status:'STOP',reason:'PROCESS_UNCERTAIN'});assert.deepEqual(await fs.readdir(f.state),[]);});
test('healthy completion, permanent exclusivity and canary absent',{skip:!capable},async t=>{const f=await fixture(t);assert.equal((await supervise(f.file,f.options)).status,'COMPLETED');assert.equal((await supervise(f.file,f.options)).reason,'ALREADY_SUPERVISED');for(const name of await fs.readdir(f.state)){if(name.endsWith('.json')&&!['checkpoint.json'].includes(name))assert.ok(!(await fs.readFile(path.join(f.state,name),'utf8')).includes('CANARY_SECRET'));}});
for(const [mode,mutate,expected] of [
 ['slow-exit',async()=>{},'COMPLETED'],
 ['slow-missing',async()=>{},'STOP'],
 ['slow-exit',async f=>fs.writeFile(path.join(f.owner,'host-off'),''),'STOP'],
 ['slow-exit',async f=>{f.m.resumePrompt='changed';await fs.writeFile(f.file,JSON.stringify(f.m));},'STOP'],
 ['slow-exit',async f=>{const p=path.join(f.state,'state.json');const s=JSON.parse(await fs.readFile(p,'utf8'));s.attempt=1;await fs.writeFile(p,JSON.stringify(s));},'STOP'],
 ['slow-exit',async f=>{f.m.codexSha256='0'.repeat(64);await fs.writeFile(f.file,JSON.stringify(f.m));},'STOP'],
 ['slow-exit',async f=>exec('git',['checkout','-b','wrong-branch'],{cwd:f.work}),'STOP'],
 ['slow-exit',async f=>{const p=path.join(f.state,'state.json');const s=JSON.parse(await fs.readFile(p,'utf8'));s.taskId='foreign';await fs.writeFile(p,JSON.stringify(s));},'STOP']
])test('real controller SIGKILL: '+mode+' '+mutate.toString(),{skip:!capable,timeout:60000},async t=>{
 const f=await fixture(t,mode);const running=supervise(f.file,f.options);
 const s=await waitState(f,s=>s.threadId&&s.childIdentity||mode==='slow-missing'&&s.childIdentity);
 const before=await identity(s.controllerIdentity.pid);assert.deepEqual(before,s.controllerIdentity);assert.equal(await exited(s.childIdentity),false);
 process.kill(before.pid,'SIGKILL');await mutate(f);
 const r=await running;assert.equal(r.status,expected);
 if(expected==='COMPLETED'){assert.equal(await fs.readFile(path.join(f.state,'effect-once.txt'),'utf8'),'effect\n');assert.equal(JSON.parse(await fs.readFile(path.join(f.state,'resumed.json'),'utf8')).threadId,s.threadId);}
 await sleep(2400);
});
test('direct recover rejects missing external evidence',async t=>{const f=await fixture(t);assert.equal((await runManifest(f.m,{recover:true})).status,'STOP');assert.ok(!(await fs.readdir(f.state)).includes('checkpoint.json'));});
test('foreign supervisor claim prevents ordinary controller launch',async t=>{const f=await fixture(t);await fs.writeFile(path.join(f.state,'supervisor-owner.json'),'{}');assert.equal((await runManifest(f.m)).reason,'RECOVERY_EVIDENCE');});
for(const contents of ['{','{}'])test('corrupted or foreign supervisor claim never overwritten '+contents,async t=>{const f=await fixture(t);await fs.writeFile(path.join(f.state,'supervisor-owner.json'),contents);const r=await supervise(f.file,f.options);assert.equal(r.status,'STOP');assert.equal(await fs.readFile(path.join(f.state,'supervisor-owner.json'),'utf8'),contents);});

test('real test controller termination leaves fake child to exit naturally; no replay', {timeout:35000},async t=>{
 const f=await fixture(t,'slow-exit');
 const module=new URL('./controller.mjs',import.meta.url).href;
 const code=`import {runManifest} from ${JSON.stringify(module)};await runManifest(${JSON.stringify(f.m)},${JSON.stringify(f.options.controllerOptions)});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:'ignore',windowsHide:true});
 const dead=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
 const s=await waitState(f,s=>s.threadId&&s.childPid);
 assert.notEqual(s.childPid,child.pid);process.kill(s.childPid,0);
 child.kill('SIGKILL');const result=await dead;assert.ok(result.signal||result.code!==0);
 // The orphan is bounded by fake-codex's own timer; never send it a signal.
 await sleep(3000);
 assert.equal(await fs.readFile(path.join(f.state,'effect-once.txt'),'utf8'),'effect\n');
 await assert.rejects(fs.stat(path.join(f.state,'resumed.json')));
 assert.equal((await runManifest(f.m,f.options.controllerOptions)).reason,'ALREADY_CLAIMED');
});

test('active orphan deadline STOP without replay or killing orphan',{skip:!capable,timeout:20000},async t=>{
 const f=await fixture(t,'slow-orphan');f.options.deadlineMs=4500;
 const running=supervise(f.file,f.options);
 const s=await waitState(f,s=>s.childIdentity&&s.threadId);
 assert.deepEqual(await identity(s.controllerIdentity.pid),s.controllerIdentity);
 process.kill(s.controllerIdentity.pid,'SIGKILL');
 const r=await running;assert.equal(r.status,'STOP');assert.ok(['ORPHAN_TIMEOUT','DEADLINE'].includes(r.reason),JSON.stringify(r));
 await assert.rejects(fs.stat(path.join(f.state,'resumed.json')));
 await sleep(6500);
});
