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
