import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fixedRunnerIsProvisioned,isOwnerStopped} from './run-once.mjs';
import {BROKER_RUNNER,BROKER_LAUNCHER} from './task-xml.mjs';
import {createWindowsInstallerIo} from './windows-io.mjs';
import {fixedInstallCommand} from './broker.mjs';
import {ALLOWED_INSTALLS} from './contract.mjs';
import {trustedStagePath} from './windows-package.mjs';

test('developer workspace cannot impersonate elevated protected runner',()=>{
  assert.equal(fixedRunnerIsProvisioned(),false);
  assert.equal(fixedRunnerIsProvisioned({selfPath:'C:\\Users\\krado\\NEXUS-workspace\\run-once.mjs',
    expected:BROKER_RUNNER,elevated:true,aclValid:true}),false);
  assert.equal(fixedRunnerIsProvisioned({selfPath:BROKER_RUNNER,elevated:false,aclValid:true}),false);
  assert.equal(fixedRunnerIsProvisioned({selfPath:BROKER_RUNNER,elevated:true,aclValid:false}),false);
  // In-memory function probe ONLY, never registering or executing a task.
  if(process.platform==='win32')
    assert.equal(fixedRunnerIsProvisioned({selfPath:BROKER_RUNNER,elevated:true,aclValid:true}),true);
});

test('Windows I/O only launches the fixed MSI command without arbitrary flags', {skip:process.platform!=='win32'},async()=>{
  const seen=[];
  const fake=(exe,args)=>{seen.push({exe,args});return {status:0}};
  const io=createWindowsInstallerIo({spawn:fake});
  const sha=ALLOWED_INSTALLS['chrome-remote-desktop-host-157'].sha256;
  const cmd=fixedInstallCommand(trustedStagePath(),sha);
  assert.deepEqual(await io.runFixedInstaller(cmd),{exitCode:0});
  assert.equal(seen.length,1);
  assert.deepEqual(seen[0],{exe:'C:\\Windows\\System32\\msiexec.exe',
    args:['/i',trustedStagePath(),'/qn','/norestart']});
  await assert.rejects(io.runFixedInstaller({...cmd,args:['/i','C:\\Temp\\evil.msi']}),/arbitrary_command_refused/);
  assert.equal(seen.length,1);
});

test('elevated script and native launcher paths are not user-writable workspace',()=>{
  assert.equal(path.win32.normalize(BROKER_RUNNER),
    path.win32.join('C:\\Program Files','NEXUS','InstallerBroker','run-once.mjs'));
  assert.equal(path.win32.normalize(BROKER_LAUNCHER),
    path.win32.join('C:\\Program Files','NEXUS','InstallerBroker','NEXUS-Broker-Launcher.exe'));
});

test('persisted owner STOP is a deny-only signal and corrupt state fails closed',()=>{
  const mock=(record)=>({
    existsSync(p){return p.endsWith('owner-stop.json');},
    readFileSync(){return record;}
  });
  assert.equal(isOwnerStopped({home:'C:\\Users\\krado',fsImpl:mock('{"stopped":true}')}),true);
  assert.equal(isOwnerStopped({home:'C:\\Users\\krado',fsImpl:mock('{"stopped":false}')}),false);
  assert.equal(isOwnerStopped({home:'C:\\Users\\krado',fsImpl:mock('{malformed')}),true);
  assert.equal(isOwnerStopped({home:'C:\\Users\\krado',fsImpl:{existsSync:()=>false}}),false);
});
