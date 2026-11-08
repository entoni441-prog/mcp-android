import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {generateTaskXml,BROKER_LAUNCHER} from './task-xml.mjs';
import {createProtectedJournal} from './journal.mjs';
import {inspectSignedGoogleMsi,trustedSourcePath} from './windows-package.mjs';

test('admin provisioning task is fixed, highest privilege, on-demand and single-instance',()=>{
  const xml=generateTaskXml({ownerSid:'S-1-5-21-100-200-300-500'});
  assert.match(xml,/<RunLevel>HighestAvailable<\/RunLevel>/);
  assert.match(xml,/<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(xml,/<AllowStartOnDemand>true<\/AllowStartOnDemand>/);
  assert.match(xml,/<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  assert.doesNotMatch(xml,/--run-once/);
  assert.ok(xml.includes(BROKER_LAUNCHER)&&!xml.includes('node.exe'));
  assert.doesNotMatch(xml.match(/<Command>([^<]+)<\/Command>/)?.[1]||'',/SYSTEM|powershell|cmd\.exe|http:/i);
});
test('task cannot be changed to attacker-controlled script or executable',()=>{
  const sid='S-1-5-21-100-200-300-500';
  assert.throws(()=>generateTaskXml({ownerSid:sid,launcher:'C:\\Users\\krado\\evil.mjs'}),/broker_executable_must_be_pinned/);
  assert.throws(()=>generateTaskXml({ownerSid:sid,launcher:'C:\\Temp\\node.exe'}),/broker_executable_must_be_pinned/);
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

test('native launcher compiles on Windows and rejects developer, non-admin execution', {skip:process.platform!=='win32'},()=>{
  const compiler='C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  if(!fs.existsSync(compiler))throw Error('trusted_native_compiler_missing');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-guarded-launcher-'));
  const source=path.join(path.dirname(fileURLToPath(import.meta.url)),'BrokerLauncher.cs');
  const exe=path.join(folder,'broker-test.exe');
  try{
    const build=spawnSync(compiler,['/nologo','/target:exe','/platform:x64','/out:'+exe,source],
      {windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:8000});
    assert.equal(build.status,0,'C# build failed: '+build.stdout+' '+build.stderr);
    assert.equal(fs.existsSync(exe),true);
    const output=spawnSync(exe,[],{windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:1024,
      env:{...process.env,NODE_OPTIONS:'--no-warnings'}});
    assert.equal(output.status,41,'dev executable must refuse before starting elevated Node: '+JSON.stringify({error:output.error?.code,message:output.error?.message,signal:output.signal}));
    assert.equal(output.stdout,'');
    const probe=spawnSync(exe,['--verify-acl'],{windowsHide:true,encoding:'utf8',timeout:10000});
    assert.equal(probe.status,41,'developer copy cannot claim protected ACL');
  }finally{
    fs.rmSync(folder,{recursive:true,force:true});
  }
});
