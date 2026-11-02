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

test('Owner 02.11: ending a process in Task Manager needs consent; ordinary Task Manager use stays free', () => {
  for (const n of ['End task', 'End process tree', 'End process', 'Снять задачу', 'Завершить процесс', 'Завершить дерево процессов', 'Termina attività'])
    assert.equal(classifyDestructiveClick({elem: {controlType: 'Button', name: n}})?.what, 'destructive_action', n);
  for (const n of ['Run new task', 'Запустить новую задачу', 'Efficiency mode', 'Details', 'Processes', 'Endpoint', 'Sending report'])
    assert.equal(classifyDestructiveClick({elem: {controlType: 'Button', name: n}}), null, n);
  const dlg = {title: 'Task Manager', text: ['Do you want to end the process tree of "app.exe"?', 'Unsaved data will be lost.']};
  assert.equal(classifyDestructiveClick({elem: {controlType: 'Button', name: 'End process tree'}, dialog: dlg})?.what, 'destructive_action');
  assert.equal(classifyDestructiveClick({elem: {controlType: 'Button', name: 'Cancel'}, dialog: dlg}), null);
  assert.equal(classifyDestructiveKeys('delete', {elem: {controlType: 'TreeItem', name: 'app.exe'}})?.what, 'destructive_action', 'Del on a selected process row');
});

// ── Acceptance run 02.11 (ChatGPT, 220e84a): Explorer app_not_found, Task Manager uia_failed (Access is denied) ──
import os from 'node:os';
import path from 'node:path';
import {createApps} from './apps.mjs';
import {createConsent} from './consent.mjs';
import {validateCapabilities} from './capabilities.mjs';
import {buildIndex} from './discover.mjs';

function appsFake({caps = {}, snaps = []} = {}) {
  const launched = []; let i = 0;
  const launcher = (exe, args = []) => { launched.push([exe, args]); const h = {}; return {pid: 77, once: (ev, fn) => { if (ev === 'spawn') setImmediate(fn); return h; }, unref() {}}; };
  const gui = {snapshotApp: async () => snaps[Math.min(i++, snaps.length - 1)] ?? []};
  const a = createApps({caps: validateCapabilities(caps), store: null, consent: createConsent(), gui, workspace: fs.mkdtempSync(path.join(os.tmpdir(), 'nx-i052-')),
    platform: 'win32', systemRoot: 'C:\\Windows', launcher, exists: () => true, wait: async () => {}, discovery: {list: async () => [], find: async () => null}});
  return {a, launched};
}

test('open_app explorer / file-explorer: built-in %SystemRoot%\\explorer.exe without arguments, new window owned', async () => {
  for (const name of ['explorer', 'file-explorer']) {
    const {a, launched} = appsFake({snaps: [[{hwnd: 1, pid: 9, process: 'explorer', name: 'Taskbar', tabs: []}], [{hwnd: 1, pid: 9, process: 'explorer', name: 'Taskbar', tabs: []}, {hwnd: 2, pid: 9, process: 'explorer', name: 'Home', tabs: []}]]});
    const r = await a.open_app({app: name});
    assert.equal(r.started, true); assert.equal(r.via, 'builtin');
    assert.deepEqual(launched, [['C:\\Windows\\explorer.exe', []]]);
  }
  const {a, launched} = appsFake({caps: {blockedApps: ['explorer']}});
  await assert.rejects(a.open_app({app: 'explorer'}), /blocked_by_owner/);
  assert.equal(launched.length, 0, 'owner block respected');
  const {a: al} = appsFake({caps: {appAccess: 'allowlist'}});
  await assert.rejects(al.open_app({app: 'explorer'}), /app_not_allowed/, 'allowlist mode keeps 0.5.1 behaviour');
  assert.ok(!buildIndex([{name: 'File Explorer', exe: 'C:\\Windows\\explorer.exe'}]).length, 'discovery does not duplicate the built-in');
});

test('UIA «Access is denied» (elevated window, UIPI) → target_elevated, not a generic uia_failed', async () => {
  const {uiaFailure} = await import('./gui.mjs');
  const real = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><S S="Error">Exception calling "FromPoint" with "1" argument(s): "Access is denied"_x000D__x000A_</S><S S="Error">At line:134 char:5_x000D__x000A_</S></Objs>';
  const e = uiaFailure(real);
  assert.match(e.message, /^target_elevated:/); assert.match(e.detail, /line:134/);
  assert.match(uiaFailure('<Objs><S S="Error">Отказано в доступе</S></Objs>').message, /^target_elevated/);
  assert.equal(uiaFailure('<Objs><S S="Error">You cannot call a method on a null-valued expression.</S></Objs>').message, 'uia_failed');
});
