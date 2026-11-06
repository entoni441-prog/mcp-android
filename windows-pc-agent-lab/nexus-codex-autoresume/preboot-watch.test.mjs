import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {queueStopNotice} from './stop-outbox.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const monitor=path.join(here,'preboot-watch.mjs');
const launcher=path.join(here,'preboot-watch-launch.ps1');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function testRoot(t){
  const dir=path.join(os.tmpdir(),'nexus-guardian-preboot-test-'+crypto.randomBytes(4).toString('hex'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return dir;
}
async function run(exe,args,timeout=10000){
  const p=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';
  p.stdout.on('data',d=>output+=d.toString());
  const result=new Promise(resolve=>{
    p.on('exit',(code,signal)=>resolve({code,signal,output}));
    p.on('error',e=>resolve({error:e.code||'SPAWN_ERROR',output}));
  });
  return Promise.race([result,delay(timeout).then(()=>{p.kill();return {timeout:true,output};})]);
}
async function observe(file,predicate=()=>true,ms=8000){
  const end=Date.now()+ms;
  while(Date.now()<end){
    try{const v=JSON.parse(await fs.readFile(file,'utf8'));if(predicate(v))return v;}catch{}
    await delay(80);
  }
  throw Error('MONITOR_HEALTH_TIMEOUT');
}
test('standby starts with empty queue and cannot authorize recovery',async t=>{
  const root=await testRoot(t);
  const r=await run(process.execPath,[monitor,'--root',root,'--mode','once']);
  assert.equal(r.code,0);
  const s=JSON.parse(r.output);
  assert.equal(s.mode,'STANDBY_NO_EXECUTION');
  assert.equal(s.canResume,false);
  assert.equal(s.health,'OK');
  assert.equal(s.externalDelivery,'NOT_CONFIGURED');
  assert.deepEqual(s.pending,[]);
});
test('durable sanitized STOP receipt is surfaced but never sent or acknowledged',async t=>{
  const root=await testRoot(t);
  await fs.mkdir(path.join(root,'outbox'),{recursive:true});
  await queueStopNotice(path.join(root,'outbox'),{
    taskId:'guardian_preboot',epoch:1,reason:'RECONCILIATION_REQUIRED'
  });
  const r=await run(process.execPath,[monitor,'--root',root,'--mode','once']);
  assert.equal(r.code,0);
  const state=JSON.parse(r.output);
  assert.equal(state.pending.length,1);
  assert.equal(state.pending[0].reason,'RECONCILIATION_REQUIRED');
  assert.equal(state.externalDelivery,'NOT_CONFIGURED');
  assert.equal((await fs.readdir(path.join(root,'outbox'))).length,1);
});
test('malformed STOP receipt produces visible STOP without sending',async t=>{
  const root=await testRoot(t);
  await fs.mkdir(path.join(root,'outbox'),{recursive:true});
  await fs.writeFile(path.join(root,'outbox','stop-notice-e0001.json'),'{}');
  const r=await run(process.execPath,[monitor,'--root',root,'--mode','once']);
  assert.equal(r.code,0);
  assert.equal(JSON.parse(r.output).health,'STOP');
  assert.equal(JSON.parse(r.output).reason,'OUTBOX_INVALID');
});
test('owner stop is visible and stops the resident loop',async t=>{
  const root=await testRoot(t);
  await fs.mkdir(root,{recursive:true});
  await fs.writeFile(path.join(root,'owner-stop.json'),'{}');
  const r=await run(process.execPath,[monitor,'--root',root,'--mode','resident']);
  assert.equal(r.code,0);
  const h=await observe(path.join(root,'watch-summary.json'));
  assert.equal(h.ownerStop,true);
  assert.equal(h.health,'STOP');
  assert.equal(h.canResume,false);
});
test('Windows launcher holds real kernel mutex and refuses parallel instance',{timeout:16000},async t=>{
  if(process.platform!=='win32'){t.skip('Windows mutex');return;}
  const root=await testRoot(t);
  const first=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',launcher,'-Root',root],
    {windowsHide:true,stdio:['ignore','pipe','pipe']});
  let err='';
  first.stderr.on('data',x=>err+=x.toString());
  t.after(()=>{try{first.kill();}catch{}});
  await observe(path.join(root,'watch-summary.json'),x=>x.polls>=1);
  const competing=await run('powershell.exe',['-NoProfile','-NonInteractive','-File',launcher,
    '-Root',root],5000);
  assert.equal(competing.code,11,'second watcher must STOP');
  await fs.writeFile(path.join(root,'owner-stop.json'),'{}');
  const ended=await Promise.race([
    new Promise(resolve=>first.once('exit',code=>resolve({code}))),
    delay(7000).then(()=>({timeout:true}))
  ]);
  assert.equal(ended.code,0,JSON.stringify({ended,err:err.slice(0,350)}));
  const h=await observe(path.join(root,'watch-summary.json'),x=>x.ownerStop);
  assert.equal(h.health,'STOP');
});
