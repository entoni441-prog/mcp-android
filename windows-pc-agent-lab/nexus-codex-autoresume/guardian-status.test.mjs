import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readGuardianStatus} from './guardian-status.mjs';

test('status adapter exposes fixed metadata and never prompts/secrets',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nx-status-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.writeFile(path.join(dir,'state.json'),JSON.stringify({
    taskId:'safe-task',status:'RECOVERING',reason:'GUARDIAN_RESUME_ARMED',
    attempt:1,childPid:12345,threadId:'019a8f9b-1452-71c0-8a17-6915a0904d67',
    prompt:'CANARY_SECRET',token:'CANARY_SECRET',environment:{secret:'CANARY_SECRET'}
  }));
  await fs.writeFile(path.join(dir,'guardian-result.json'),JSON.stringify({
    taskId:'safe-task',status:'COMPLETED',reason:'COMPLETION_MARKER',
    credential:'CANARY_SECRET'
  }));
  const result=await readGuardianStatus(dir);
  assert.equal(result.controller.status,'RECOVERING');
  assert.equal(result.guardian.status,'COMPLETED');
  assert.equal(result.controller.attempt,1);
  assert.ok(!JSON.stringify(result).includes('CANARY_SECRET'));
  assert.ok(!Object.hasOwn(result.controller,'prompt'));
  assert.ok(!Object.hasOwn(result.guardian,'credential'));
  assert.deepEqual((await fs.readdir(dir)).sort(),['guardian-result.json','state.json']);
});
test('status adapter fails closed on untrusted or missing files',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nx-status-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  assert.deepEqual(await readGuardianStatus('relative/path'),{status:'STOP',reason:'PATH_REQUIRED'});
  const result=await readGuardianStatus(dir);
  assert.deepEqual(result,{controller:{status:'UNKNOWN'},guardian:{status:'UNKNOWN'}});
  await fs.writeFile(path.join(dir,'state.json'),'not-json');
  assert.equal((await readGuardianStatus(dir)).controller.status,'UNKNOWN');
});
