import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {TOOLS as HOST} from './catalog.mjs';
import {TOOLS as GATEWAY} from '../nexus-gateway/src/catalog.mjs';
import {STALE_TOOLS} from './server.mjs';
import {WORK_TOOLS} from './session.mjs';
import {UIA_SCRIPT} from './uia-script.mjs';

test('NX-TM-01: Host and Gateway expose identical, owner-scoped minimize_window', () => {
  assert.equal(JSON.stringify(HOST),JSON.stringify(GATEWAY));
  const item=HOST.filter(x=>x.name==='minimize_window');
  assert.equal(item.length,1);
  assert.deepEqual(item[0].inputSchema.required,['pid','ownerRequested']);
  assert.equal(item[0].inputSchema.properties.ownerRequested.type,'boolean');
  assert.equal(item[0].inputSchema.additionalProperties,false);
  assert.equal(WORK_TOOLS.has('minimize_window'),true);
  assert.equal(STALE_TOOLS.has('minimize_window'),true);
});
test('NX-TM-01: terminal input stays guarded in normal policy and only fixed visual state mode exists', () => {
  assert.match(UIA_SCRIPT,/'minimize'\s*\{/);
  assert.match(UIA_SCRIPT,/SetWindowVisualState\(\[System\.Windows\.Automation\.WindowVisualState\]::Minimized\)/);
  assert.match(UIA_SCRIPT,/NxTopOf \$w/);
  assert.match(UIA_SCRIPT,/\$res\.hwnd\s*=\s*\[int64\]\$a\.hwnd/);
  assert.match(UIA_SCRIPT,/NxPName \$res\.pid\) -ieq 'WindowsTerminal'/);
  const op=UIA_SCRIPT.slice(UIA_SCRIPT.indexOf("  'minimize' {"),
    UIA_SCRIPT.indexOf("  'activate' {"));
  assert.ok(!/AppActivate|SendKeys|Invoke-Expression|Start-Process|SetFocus|WScript\.Shell|(?:\s|^)cmd\.exe/.test(op));
});
test('NX-TM-01: the embedded fixed PowerShell UIA script parses without executing it on Windows',t=>{
  if(process.platform!=='win32'){t.skip('Windows parser');return;}
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-tm-ast-'));
  const file=path.join(dir,'fixed-uia.ps1');
  // Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI. The actual Host uses UTF-16LE -EncodedCommand.
  // Include UTF-8 BOM here so the parser sees the same Cyrillic UIA regexes as the Host.
  fs.writeFileSync(file,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(UIA_SCRIPT,'utf8')]));
  try{
    const parser="$tokens=$null;$errors=$null; [System.Management.Automation.Language.Parser]::ParseFile($env:NEXUS_TEST_UIA_AST,[ref]$tokens,[ref]$errors) | Out-Null; if($errors.Count -gt 0){ $errors | Select-Object -First 6 | ForEach-Object { Write-Output ('ErrorId='+$_.ErrorId+';Line='+$_.Extent.StartLineNumber+';Column='+$_.Extent.StartColumnNumber+';Text='+$_.Extent.Text.Substring(0,[Math]::Min(60,$_.Extent.Text.Length))) }; exit 1 }; Write-Output 'POWERSHELL_AST_PASS'";
    const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',parser],
      {encoding:'utf8',timeout:12000,env:{...process.env,NEXUS_TEST_UIA_AST:file}});
    assert.equal(r.status,0,(r.stdout||'')+'\n'+(r.stderr||''));
    assert.match(r.stdout,/POWERSHELL_AST_PASS/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
