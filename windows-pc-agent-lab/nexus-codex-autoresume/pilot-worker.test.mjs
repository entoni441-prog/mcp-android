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
const worker=fileURLToPath(new URL('./pilot-worker.mjs',import.meta.url));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('synthetic worker resumes once after exact child crash', {timeout:15000},async t=>{
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-codex-live-test-'));
  const dir=path.join(parent,'work');await fs.mkdir(dir);
  t.after(()=>fs.rm(parent,{recursive:true,force:true}));
  const p=spawn(process.execPath,[worker,'start',dir],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  let ready=false,output='';
  p.stdout.on('data',d=>{output+=d;ready=output.includes('PILOT_READY pid='+p.pid);});
  let closed=false;const dead=new Promise(resolve=>p.once('close',()=>{closed=true;resolve()}));
  try{
    for(let i=0;i<120&&!ready;i++)await sleep(30);
    assert.ok(ready,'real pilot child did not reach READY');
    const effect=path.join(dir,'effect-once.txt');
    const before=crypto.createHash('sha256').update(await fs.readFile(effect)).digest('hex');
    process.kill(p.pid,'SIGKILL');
    await dead;
    const after=await exec(process.execPath,[worker,'resume',dir],{timeout:6000,windowsHide:true});
    assert.equal(after.stdout.trim(),'PILOT_RECOVERED');
    assert.equal(crypto.createHash('sha256').update(await fs.readFile(effect)).digest('hex'),before);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'complete.json'),'utf8')),{taskId:'nx-cli-live-20261106',status:'completed'});
    await assert.rejects(exec(process.execPath,[worker,'resume',dir],{timeout:6000,windowsHide:true}));
  }finally{if(!closed)try{p.kill('SIGKILL')}catch{}}
});
test('unsafe sandbox path fails closed',async()=>{
  await assert.rejects(exec(process.execPath,[worker,'start','C:\\Windows'],{timeout:3000,windowsHide:true}));
});
