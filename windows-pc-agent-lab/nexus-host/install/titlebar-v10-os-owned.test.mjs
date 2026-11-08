import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scheduledXml} from './schedule-os-owned-titlebar-v10.mjs';
const a=readFileSync(new URL('./os-owned-activate-titlebar-v10.mjs',import.meta.url),'utf8');
const c=readFileSync(new URL('./schedule-os-owned-titlebar-v10.mjs',import.meta.url),'utf8');

test('v10 activation pins exactly 3 files and verifies hashes before interruption',()=>{
  assert.match(a,/const FILES=Object.keys\(OLD\)/);
  const files=['gui.mjs','uia-script.mjs','policy.mjs'];
  for(const f of files){assert.ok(a.includes("'"+f+"'"),f);}
  assert.match(a,/verifyHashes\(HOST,OLD,'installed_version_conflict'\)/);
  assert.match(a,/verifyHashes\(SOURCE,NEW/);
  assert.match(a,/verifyHashes\(BACKUP,OLD,'backup_hash_mismatch'\)/);
  assert.match(a,/copyFiles\(BACKUP,OLD,'rollback_hash_failed'\)/);
  assert.match(a,/assertIndependent\(old\)/);
  assert.match(a,/in_host_process_tree_refused/);
  assert.match(a,/releaseMaintenance\(\)/);
  assert.match(a,/installed_verified/);
  assert.match(a,/rollback_verified/);
});

test('dedicated v10 task and state paths avoid touching earlier activations',()=>{
  assert.match(a,/NEXUS-Titlebar-v10-Activation/);
  assert.match(c,/NEXUS-Titlebar-v10-Activation/);
  assert.match(a,/_backup-titlebar-v10-pre-20261108/);
  assert.match(a,/_activate-titlebar-v10-20261108/);
  assert.match(c,/SCHEDULER_INDEPENDENT_PASS/);
  assert.match(c,/no_fresh_verified_probe/);
  assert.match(c,/OS_OWNED_ACTIVATION_REQUESTED/);
  assert.doesNotMatch(a,/NEXUS-Natural-Touch-Activation/);
  assert.doesNotMatch(c,/NEXUS-Natural-Touch-Activation/);
});

test('scheduler stays least privilege and requires independent verified probe',()=>{
  const xml=scheduledXml({
    sid:'S-1-5-21-111-222-333-444',
    node:'C:\\Program Files\\nodejs\\node.exe',
    script:'C:\\NEXUS-workspace\\nexus-host\\install\\os-owned-activate-titlebar-v10.mjs'
  });
  assert.match(xml,/InteractiveToken/);
  assert.match(xml,/LeastPrivilege/);
  assert.match(xml,/IgnoreNew/);
  assert.match(xml,/--deploy/);
  assert.match(xml,/2035-01-01/);
});

test('host 3-file checksums are version-pinned',()=>{
  const old=['3b487cfb1b4b3451e8339d7c7a0e515acd76cd87a91a2ffbc9c467d85bb1f0f5','02044e8c74c778995a30ddab71245772bff5972ff4bf81a573fc9e6f90571d8e','775a16fe70b24dfc7bf51290f10abbbe0f4bcc3c9d38cac26e2df00852fc6a69'];
  const next=['b544780e275a0c4bcb775c115fc28fbc7752217be9b6675b2edb1f4d86cc29c1','df9e938b37f0a4e8013758b9367fb236fe55ce12e396419963da52894e34acee','f1c5051770de025677bc95466589483f99e0cbce8f92035b664ca777433b6240'];
  for(const sum of [...old,...next])assert.ok(a.includes(sum),sum);
});
