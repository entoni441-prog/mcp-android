import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateTaskXml,BROKER_RUNNER,NODE_PATH} from './task-xml.mjs';
import {createProtectedJournal} from './journal.mjs';
import {inspectSignedGoogleMsi,trustedSourcePath} from './windows-package.mjs';

test('admin provisioning task is fixed, highest privilege, on-demand and single-instance',()=>{
  const xml=generateTaskXml({ownerSid:'S-1-5-21-100-200-300-500'});
  assert.match(xml,/<RunLevel>HighestAvailable<\/RunLevel>/);
  assert.match(xml,/<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(xml,/<AllowStartOnDemand>true<\/AllowStartOnDemand>/);
  assert.match(xml,/<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  assert.match(xml,/--run-once/);
  assert.ok(xml.includes(BROKER_RUNNER)&&xml.includes(NODE_PATH));
  assert.doesNotMatch(xml,/SYSTEM|powershell|cmd\.exe|http:/);
});
test('task cannot be changed to attacker-controlled script or executable',()=>{
  const sid='S-1-5-21-100-200-300-500';
  assert.throws(()=>generateTaskXml({ownerSid:sid,taskRunner:'C:\\Users\\krado\\evil.mjs'}),/broker_executable_must_be_pinned/);
  assert.throws(()=>generateTaskXml({ownerSid:sid,node:'C:\\Temp\\node.exe'}),/broker_executable_must_be_pinned/);
  assert.throws(()=>generateTaskXml({ownerSid:'administrator'}),/invalid_owner_sid/);
});
test('journal claim persists on disk with replay refusal and stable request receipt', {skip:process.platform!=='win32'},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-broker-journal-'));
  const id=crypto.randomBytes(16).toString('hex'),receipt={requestId:id,channel:'live'};
  try{
    const j=createProtectedJournal(dir);
    assert.equal(j.claim(id,receipt),true);
    assert.equal(j.claim(id,receipt),false);
    j.mark(id,'executing');
    j.mark(id,'outcome_unknown');
    assert.equal(createProtectedJournal(dir).inspect(id).state,'outcome_unknown');
    assert.throws(()=>j.claim('../../escape',receipt),/invalid_request_id/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('read-only Authenticode integration: Google MSI only, verified size and SHA', {skip:process.platform!=='win32'},()=>{
  const file=trustedSourcePath();
  if(!fs.existsSync(file))return;
  const rec=inspectSignedGoogleMsi(file);
  assert.equal(rec.signatureValid,true);
  assert.equal(rec.publisher,'Google LLC');
  assert.ok(rec.sha256.length===64);
  assert.throws(()=>inspectSignedGoogleMsi('C:\\Windows\\System32\\cmd.exe'),/untrusted_msi_path/);
});
