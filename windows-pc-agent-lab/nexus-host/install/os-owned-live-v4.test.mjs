import test from 'node:test';
import assert from 'node:assert/strict';
import {maintenanceDecision,MAINTENANCE_MAX_MS} from '../recovery/maintenance-policy.mjs';
import {scheduledXml} from './schedule-os-owned-live-v4.mjs';
const now=1_794_054_000_000;
test('maintenance guard permits only tightly bounded OS updater',()=>{
 const mk=(beganAt,expiresAt)=>({version:1,kind:'nexus_os_owned_update_v4',beganAt,expiresAt});
 assert.equal(maintenanceDecision(null,now).action,'NONE');
 assert.equal(maintenanceDecision(mk(now,now+9*60_000),now).action,'MAINTENANCE_ACTIVE');
 assert.equal(maintenanceDecision(mk(now-60_000,now-1),now).action,'EXPIRED');
 assert.equal(maintenanceDecision(mk(now,now+MAINTENANCE_MAX_MS+1),now).action,'INVALID_STOP');
 assert.equal(maintenanceDecision(mk(now+1,now+60000),now).action,'INVALID_STOP');
 assert.equal(maintenanceDecision({},now).action,'INVALID_STOP');
 assert.equal(maintenanceDecision({...mk(now,now+60_000),admin:true},now).action,'INVALID_STOP');
});
test('activation task is a separate least-privilege once task with no auto-restart',()=>{
 const sid='S-1-5-21-344202164-1219418574-2620215642-1001';
 const node='C:\\Program Files\\nodejs\\node.exe';
 const script='C:\\Users\\krado\\NEXUS-workspace\\lab\\windows-pc-agent-lab\\nexus-host\\install\\os-owned-activate-live-v4.mjs';
 const xml=scheduledXml({sid,node,script});
 assert.match(xml,/encoding="UTF-16"/);
 assert.match(xml,/<LogonType>InteractiveToken<\/LogonType>/);
 assert.match(xml,/<RunLevel>LeastPrivilege<\/RunLevel>/);
 assert.match(xml,/<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
 assert.match(xml,/<ExecutionTimeLimit>PT7M<\/ExecutionTimeLimit>/);
 assert.match(xml,/2035-01-01T00:00:00/);
 assert.match(xml,/<Arguments>&quot;.*os-owned-activate-live-v4\.mjs&quot; --deploy<\/Arguments>/);
 assert.doesNotMatch(xml,/<BootTrigger>|<RestartOnFailure>|<LogonTrigger>|S-1-5-18/);
});
test('task creation refuses non-node, relative path and invalid owner',()=>{
 const args={sid:'S-1-5-21-1-2-3-1001',node:'C:\\Program Files\\nodejs\\node.exe',script:'C:\\Users\\krado\\os-owned-activate-live-v4.mjs'};
 assert.throws(()=>scheduledXml({...args,sid:'S-1-5-18'}),/invalid_owner_sid/);
 assert.throws(()=>scheduledXml({...args,node:'C:\\Windows\\cmd.exe'}),/invalid_node/);
 assert.throws(()=>scheduledXml({...args,script:'./activate.mjs'}),/invalid_script/);
});
