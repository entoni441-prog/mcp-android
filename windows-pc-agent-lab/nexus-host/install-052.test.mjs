// 0.5.2 fixes after the owner-PC install attempt (02.11.2026): Explorer inspect_ui, readable uia_failed, Host exit log.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {psErrorText} from './gui.mjs';
import {UIA_SCRIPT} from './uia-script.mjs';
import {classifyDestructiveClick, classifyDestructiveKeys} from './policy.mjs';

test('uia-script: no raw ControlType.ProgrammaticName method calls (null for control types managed UIA does not know)', () => {
  const raw = UIA_SCRIPT.match(/\.ControlType\.ProgrammaticName\.Replace/g) || [];
  assert.equal(raw.length, 0);
  assert.match(UIA_SCRIPT, /function NxType\(\$e\)/);
  assert.match(UIA_SCRIPT, /unreadable = \$true/, 'tree walk survives an unreadable element');
});

test('psErrorText: CLIXML progress dropped, error line + position kept (real sample shape from the install)', () => {
  const raw = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T></TN><MS><I64 N="SourceId">1</I64><PR N="Record"><AV>Preparing modules</AV></PR></MS></Obj>'
    + '<S S="Error">ForEach-Object : You cannot call a method on a null-valued expression._x000D__x000A_</S><S S="Error">At line:212 char:9_x000D__x000A_</S><S S="Error">+ $node = @{ type = ... &lt;&lt;&lt;&lt;_x000D__x000A_</S></Objs>';
  const t = psErrorText(raw);
  assert.ok(!t.includes('<Obj'), t);
  assert.match(t, /null-valued expression/);
  assert.match(t, /At line:212 char:9/);
  assert.match(t, /<<<</);
  assert.equal(psErrorText('plain error'), 'plain error');
});

test('R-01 fail-closed for control types UIA cannot name (Unknown)', () => {
  assert.equal(classifyDestructiveClick({elem: {controlType: 'Unknown', name: 'Delete'}})?.what, 'destructive_action');
  assert.equal(classifyDestructiveClick({elem: {controlType: 'Unknown', name: 'Open'}}), null);
  const dlg = {title: 'Delete File', text: ['Are you sure you want to permanently delete this file?']};
  assert.equal(classifyDestructiveClick({elem: {controlType: 'Unknown', name: 'Yes'}, dialog: dlg})?.what, 'destructive_action');
  assert.equal(classifyDestructiveClick({elem: {controlType: 'Unknown', name: 'No'}, dialog: dlg}), null);
  assert.equal(classifyDestructiveKeys('enter', {elem: {controlType: 'Unknown', name: 'Remove'}})?.what, 'destructive_action');
});

test('nexus.mjs logs every exit Node can see (crash stack / exit code) to tunnel.log', () => {
  const src = fs.readFileSync(new URL('./nexus.mjs', import.meta.url), 'utf8');
  for (const k of ["'uncaughtException'", "'unhandledRejection'", "process.on('exit'", "'host_exit'"]) assert.ok(src.includes(k), k);
});
