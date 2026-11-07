import test from 'node:test';
import assert from 'node:assert/strict';
import {decideRecovery,WINDOW_MS,STABLE_MS} from './recovery-policy.mjs';
import {verifyTaskXml} from './recovery-watchdog.mjs';
const t=1_800_000_000_000;
const base={now:t,healthy:false,ownerOff:false,existingHostAlive:false,taskVerified:true,state:{}};
const run=o=>decideRecovery({...base,...o});

test('start preexisting scheduler task at most once after offline evidence',()=>{
  const first=run({});
  assert.equal(first.action,'START_EXISTING_TASK');
  assert.deepEqual(first.next.attempts,[t]);
  assert.equal(run({now:t+60_000,state:first.next}).action,'RETRY_COOLDOWN');
  assert.equal(run({now:t+120_000,state:first.next}).action,'START_EXISTING_TASK');
});
test('owner explicitly turned off NEXUS: no recovery regardless of health',()=>{
  const r=run({ownerOff:true});
  assert.equal(r.action,'OWNER_OFF');
  assert.deepEqual(r.next.attempts,[]);
});
test('live but unhealthy Host: no duplicate launch or forced termination',()=>{
  assert.equal(run({existingHostAlive:true}).action,'HOST_ALIVE_UNHEALTHY_STOP');
});
test('unverified task identity: cannot launch',()=>{
  assert.equal(run({taskVerified:false}).action,'TASK_IDENTITY_UNVERIFIED');
});
test('maximum three attempts in rolling 30m; old attempts roll off',()=>{
  const state={attempts:[t-1_000_000,t-800_000,t-300_000]};
  assert.equal(run({state}).action,'RESTART_BUDGET_EXHAUSTED');
  assert.equal(run({now:t+WINDOW_MS,state}).action,'START_EXISTING_TASK');
});
test('health cannot reset restart budget until continuous 30m stable',()=>{
  const state={attempts:[t-2000],healthySince:null};
  const begin=run({healthy:true,taskVerified:false,state});
  assert.equal(begin.action,'HEALTHY');
  assert.equal(begin.next.attempts.length,1);
  const mid=run({healthy:true,now:t+STABLE_MS-1000,state:begin.next});
  assert.equal(mid.next.attempts.length,0,'rolling time budget clears old attempts');
  const st2={attempts:[t+STABLE_MS-4000],healthySince:t};
  const completed=run({healthy:true,now:t+STABLE_MS,state:st2});
  assert.deepEqual(completed.next.attempts,[]);
});
test('invalid journal stops safely, no fail-open',()=>{
  assert.throws(()=>run({state:{attempts:['2026-01-01']}}),/bad_journal/);
  assert.throws(()=>run({now:-1}),/bad_observation/);
  assert.throws(()=>run({state:{attempts:[t+1]}}),/bad_journal/);
});
test('only exact preexisting Node task script is trusted',()=>{
  const installed='C:\\Users\\krado\\Documents\\NEXUS\\nexus-host\\nexus.mjs';
  const xml='<Task><Actions><Exec><Command>C:\\Program Files\\nodejs\\node.exe</Command><Arguments>&quot;'+installed+'&quot;</Arguments></Exec></Actions></Task>';
  assert.equal(verifyTaskXml(xml,installed),true);
  assert.equal(verifyTaskXml(xml.replace('nexus.mjs','other.mjs'),installed),false);
  assert.equal(verifyTaskXml(xml.replace('node.exe','powershell.exe'),installed),false);
  assert.equal(verifyTaskXml(xml.replace('nexus.mjs&quot;','nexus.mjs&quot; --extra'),installed),false);
  assert.equal(verifyTaskXml(xml.replace(installed,'C:\\Users\\other\\nexus.mjs'),installed),false);
});

test('do not race a running NEXUS Supervisor',()=>{
  assert.equal(run({supervisorAlive:true}).action,'SUPERVISOR_PRESENT_WAIT');
  assert.deepEqual(run({supervisorAlive:true}).next.attempts,[]);
});
