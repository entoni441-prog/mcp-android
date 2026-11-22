import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {UIA_SCRIPT} from './uia-script.mjs';

test('Native UIA script parses on Windows without executing UIA', {skip: process.platform !== 'win32'}, () => {
  const parse = "$source=[Console]::In.ReadToEnd(); $tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors); if($errors.Count -gt 0){ $errors | ForEach-Object { $_.Message }; exit 1 }; Write-Output PARSE_OK";
  const r = spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',parse],{input:UIA_SCRIPT, encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(r.error,undefined);
  assert.equal(r.status,0,String(r.stdout)+' '+String(r.stderr));
  assert.match(r.stdout,/PARSE_OK/);
});

import {checkWindows} from './native-identity-readonly-probe.mjs';
import {fixtureIdentity} from './window-identity-fixture.mjs';
const win=h=>fixtureIdentity({hwnd:h,pid:50,process:'msedge',name:'synthetic',tabs:[]});
test('probe uses shared read-only identity_check once per HWND, including multi-window arrays',async()=>{
  for(const count of [1,2,4]){
    const calls=[];
    const result=await checkWindows('msedge',async args=>{
      calls.push(args);
      if(args.mode==='apps')return {apps:Array.from({length:count},(_,i)=>win(10+i))};
      assert.equal(args.mode,'identity_check');
      assert.equal(String(args.hwnd),args.identity.hwnd);
      return {identityCheck:{available:true,same:true,reason:'verified'}};
    });
    assert.equal(result.status,'pass');assert.equal(result.matched,count);
    assert.deepEqual(calls.slice(1).map(c=>c.hwnd),Array.from({length:count},(_,i)=>10+i));
  }
});
test('probe stops immediately on native mismatch or unavailable with no mutation',async()=>{
  for(const available of [true,false]){
    const calls=[];
    const result=await checkWindows('msedge',async args=>{
      calls.push(args.mode);
      return args.mode==='apps'?{apps:[win(10),win(11)]}:{identityCheck:{available,same:false,reason:available?'identity_mismatch':'native_identity_unavailable'}};
    });
    assert.equal(result.status,available?'native_mismatch':'native_unavailable');
    assert.deepEqual(calls,['apps','identity_check']);
    assert.equal(result.matched,0);
  }
});
test('no open windows and missing identity never count as native pass',async()=>{
  for(const apps of [[],[{hwnd:10}]]){
    const result=await checkWindows('msedge',async args=>{assert.equal(args.mode,'apps');return {apps}});
    assert.equal(result.status,apps.length?'identity_incomplete':'not_open');
  }
});
