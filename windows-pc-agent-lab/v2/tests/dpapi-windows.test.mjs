// Reproduce original Windows DPAPI pipeline using ONLY a synthetic test string.
// No network, no real identity, no personal data. Windows GitHub runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
function original(mode,input){
  const script=`$ErrorActionPreference='Stop';
  $value=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()));
  $scope=[System.Security.Cryptography.DataProtectionScope]::CurrentUser;
  if('${mode}' -eq 'protect') {$out=[System.Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($value),$null,$scope)}
  else {$out=[System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($value),$null,$scope)};
  [Console]::Out.Write([Convert]::ToBase64String($out));`;
  return spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
    input:Buffer.from(input,'utf8').toString('base64'),
    encoding:'utf8',timeout:15000,maxBuffer:1024*1024,windowsHide:true
  });
}
test('original DPAPI protect+unprotect in Windows session',()=>{
  const sample='DPAPI-SYNTHETIC-ROUNDTRIP-NO-SECRETS';
  const protectedResult=original('protect',sample);
  if(protectedResult.status!==0 || protectedResult.error){
    // This is a fixed synthetic value only; no credentials.
    throw Error('Original protect failed: status='+protectedResult.status+' error='+String(protectedResult.error?.message||'')+' stderr='+protectedResult.stderr.slice(0,1200));
  }
  const encrypted=protectedResult.stdout.trim();
  assert.match(encrypted,/^[A-Za-z0-9+/]+={0,2}$/);
  const decryptedResult=original('unprotect',encrypted);
  if(decryptedResult.status!==0||decryptedResult.error){
    throw Error('Original unprotect failed: status='+decryptedResult.status+' stderr='+decryptedResult.stderr.slice(0,1200));
  }
  assert.equal(Buffer.from(decryptedResult.stdout.trim(),'base64').toString('utf8'),sample);
});
