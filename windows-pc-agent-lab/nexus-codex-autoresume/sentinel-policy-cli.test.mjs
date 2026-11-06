import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {evaluateSnapshot} from './sentinel-policy-cli.mjs';

const valid={
  manifestApproved:true,ownerStop:false,
  guardianExitObserved:true,guardianIdentityVerified:true,
  claimsMatch:true,gitClean:true,branchMatches:true,binaryHashMatches:true,
  guardianGone:true,controllerGone:true,cliGone:true,
  rescueClaimExists:false,guardianResumeClaimExists:false,
  taskId:'snapshot-task',stateTaskId:'snapshot-task',completionMarkerValid:false,
  stateStatus:'RUNNING',attempt:0,recordedStatus:null,
  threadId:'019a8f9b-1452-71c0-8a17-6915a0904d67',
  controllerPid:101,cliPid:102
};
test('read-only adapter evaluates isolated snapshot and writes no files',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nx-policy-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'evidence.json');
  await fs.writeFile(file,JSON.stringify(valid));
  const before=(await fs.readdir(dir)).sort();
  const answer=await evaluateSnapshot(file);
  assert.equal(answer.decision,'ELIGIBLE_FOR_SINGLE_RESUME');
  assert.equal(answer.execution,'NOT_PERFORMED');
  assert.deepEqual((await fs.readdir(dir)).sort(),before);
});
test('missing, relative, malformed and unknown process evidence always STOP',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nx-policy-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  assert.equal((await evaluateSnapshot('relative.json')).decision,'STOP');
  assert.equal((await evaluateSnapshot(path.join(dir,'missing.json'))).decision,'STOP');
  const file=path.join(dir,'bad.json');
  await fs.writeFile(file,'not-json');
  assert.equal((await evaluateSnapshot(file)).reason,'READ_OR_PARSE_ERROR');
  await fs.writeFile(file,JSON.stringify({...valid,cliGone:null}));
  assert.equal((await evaluateSnapshot(file)).reason,'PROCESS_STILL_ALIVE_OR_UNKNOWN');
});
test('read-only adapter output cannot expose arbitrary snapshot fields',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nx-policy-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'evidence.json');
  await fs.writeFile(file,JSON.stringify({...valid,prompt:'CANARY_SECRET',token:'CANARY_SECRET'}));
  const output=await evaluateSnapshot(file);
  assert.equal(output.execution,'NOT_PERFORMED');
  assert.ok(!JSON.stringify(output).includes('CANARY_SECRET'));
  assert.deepEqual(Object.keys(output).sort(),['attempt','decision','execution','reason'].sort());
});
