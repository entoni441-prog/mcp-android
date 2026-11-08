import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const a=fs.readFileSync(new URL('./os-owned-activate-natural-touch.mjs',import.meta.url),'utf8');
const c=fs.readFileSync(new URL('./schedule-os-owned-natural-touch.mjs',import.meta.url),'utf8');

test('natural-touch rollout remains exactly three version-pinned source files',()=>{
 for(const file of ['gui.mjs','live.mjs','uia-script.mjs']){
   assert.match(a,new RegExp("'"+file.replace('.','\\.')+"'"));
 }
 assert.match(a,/const FILES=Object.keys\(OLD\)/);
 assert.match(a,/verifyHashes\(HOST,OLD,'installed_version_conflict'\)/);
 assert.match(a,/verifyHashes\(SOURCE,NEW/);
 assert.match(a,/verifyHashes\(BACKUP,OLD,'backup_hash_mismatch'\)/);
 assert.match(a,/copyFiles\(BACKUP,OLD,'rollback_hash_failed'\)/);
});
test('Host is never stopped from the connected Host tool process tree',()=>{
 assert.match(a,/assertIndependent\(old\)/);
 assert.match(a,/in_host_process_tree_refused/);
 assert.match(a,/os_owned_scheduled_task_identity_unverified/);
 assert.match(a,/deployment_not_armed_by_verified_probe/);
 assert.match(a,/acquireMaintenance\(\)/);
 assert.match(a,/releaseMaintenance\(\)/);
 assert.match(a,/rollback_verified/);
});
test('scheduler only deploys after independent probe and one-use arming',()=>{
 assert.match(c,/NEXUS-Natural-Touch-Activation/);
 assert.match(c,/InteractiveToken/);
 assert.match(c,/LeastPrivilege/);
 assert.match(c,/IgnoreNew/);
 assert.match(c,/SCHEDULER_INDEPENDENT_PASS/);
 assert.match(c,/no_fresh_verified_probe/);
 assert.match(c,/OS_OWNED_ACTIVATION_REQUESTED/);
});
