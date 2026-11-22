// Explicit one-shot acceptance. Not part of ordinary regression suites.
// Never points to the installed Host, browser, or user applications.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';

test('native Job Object acceptance: STOP and helper death, own three-process fixtures only',{skip:process.platform!=='win32'||process.argv.length!==3||process.argv[2]!=='--approved-one-shot'},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nxjob-native-'));
 const compiler=path.join(process.env.SystemRoot,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 let passed=false;
 try {
  for(const base of ['NexusJobHost','NexusJobAcceptance']){
   const source=fileURLToPath(new URL('./'+base+'.cs',import.meta.url));
   const target=path.join(dir,base+'.exe');
   const result=spawnSync(compiler,['/nologo','/target:exe','/platform:x64','/out:'+target,source],{cwd:dir,encoding:'utf8',windowsHide:true,timeout:20000});
   assert.equal(result.error,undefined);assert.equal(result.status,0,String(result.stdout)+' '+String(result.stderr));
   console.log(base+' sha256='+crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'));
  }
  const r=spawnSync(path.join(dir,'NexusJobAcceptance.exe'),[],{cwd:dir,encoding:'utf8',windowsHide:true,timeout:55000});
  console.log(String(r.stdout||'').trim());if(r.stderr)console.error(r.stderr.trim());
  assert.equal(r.error,undefined);assert.equal(r.status,0);
  assert.match(r.stdout,/PASS stop three_live_before=true three_exited_after=true root_ticks_match=true helper_empty_frame=true/);
  assert.match(r.stdout,/PASS helper_death three_live_before=true three_exited_after=true root_ticks_match=true helper_empty_frame=false/);
  assert.match(r.stdout,/NATIVE_JOB_ACCEPTANCE PASS/);
  passed=true;
 } finally {
  if(passed)fs.rmSync(dir,{recursive:true,force:true});
  else console.log('Failure artifacts retained in isolated temporary directory: '+dir);
 }
});
