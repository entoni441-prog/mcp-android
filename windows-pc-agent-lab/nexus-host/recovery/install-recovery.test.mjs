import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTaskXml} from './install-recovery.mjs';
const sid='S-1-5-21-100000-200000-300000-1001';
const node='C:\\Program Files\\nodejs\\node.exe';
const script='C:\\Users\\krado\\Documents\\NEXUS\\recovery-watchdog\\recovery-watchdog.mjs';
const start='2026-11-07T12:00:00';
test('limited owner interactive task, scheduler authority independent of Host',()=>{
  const xml=makeTaskXml({sid,node,script,start});
  assert.match(xml,/<RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.match(xml,/<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(xml,/<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  assert.match(xml,/<Interval>PT1M<\/Interval>/);
  assert.match(xml,/<StartWhenAvailable>true<\/StartWhenAvailable>/);
  assert.match(xml,/<ExecutionTimeLimit>PT45S<\/ExecutionTimeLimit>/);
  assert.match(xml,/recovery-watchdog.mjs/);
  assert.match(xml,/<Command>C:\\Windows\\System32\\conhost\.exe<\/Command>/i);
  assert.match(xml,/<Arguments>--headless &quot;C:\\Program Files\\nodejs\\node\.exe&quot; &quot;.*recovery-watchdog\.mjs&quot; --once<\/Arguments>/i);
  assert.doesNotMatch(xml,/S-1-5-18|HighestAvailable|Password|AutoAdminLogon|powershell\.exe|cloudflared\.exe/);
});
test('installer XML refuses invalid identity and arbitrary node/executable paths',()=>{
  assert.throws(()=>makeTaskXml({sid:'S-1-5-18',node,script,start}),/bad_user_sid/);
  assert.throws(()=>makeTaskXml({sid,node:'C:\\Windows\\System32\\cmd.exe',script,start}),/bad_node/);
  assert.throws(()=>makeTaskXml({sid,node,script:'C:\\other\\script.ps1',start}),/bad_script/);
  assert.throws(()=>makeTaskXml({sid,node,script,start:'not a time'}),/bad_date/);
  assert.throws(()=>makeTaskXml({sid,node,script,start,conhost:'C:\\Windows\\System32\\cmd.exe'}),/bad_headless_host/);
});
