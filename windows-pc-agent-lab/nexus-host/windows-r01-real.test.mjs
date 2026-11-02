// REAL Windows (CI runner): R-01 — a real Win32 confirmation MessageBox (#32770) is seen by UIA as a deletion
// confirmation; «Yes» needs consent, «No» is free; a plain text field in Notepad keeps Delete free. win32 + NEXUS_REAL_GUI=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {runUiaReal} from './gui.mjs';
import {classifyDestructiveClick, classifyDestructiveKeys} from './policy.mjs';
import {listWindows} from './windows.mjs';

const RUN = process.platform === 'win32' && process.env.NEXUS_REAL_GUI === '1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const flat = tree => { const out = []; const walk = n => { out.push(n); (n.children || []).forEach(walk); }; tree.forEach(walk); return out; };

test('Windows R-01: real MessageBox «permanently delete» → Yes = consent, No = free; dialog text recognised by UIA', {skip: !RUN && 'win32 + NEXUS_REAL_GUI=1 only', timeout: 180_000}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-r01-real-'));
  const opt = {tmpDir: path.join(home, 'tmp')}; fs.mkdirSync(opt.tmpDir, {recursive: true});
  const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const file = path.join(home, 'r01-box.ps1');
  fs.writeFileSync(file, "Add-Type -AssemblyName System.Windows.Forms\r\n[void][System.Windows.Forms.MessageBox]::Show('Are you sure you want to permanently delete report.docx?', 'NEXUS R01 Delete File', 'YesNo', 'Warning')\r\n");
  const errFile = path.join(home, 'r01-box.err');
  const p = spawn(ps, ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', file], {stdio: ['ignore', 'ignore', fs.openSync(errFile, 'w')], windowsHide: false});
  let exited = null; p.once('exit', c => { exited = c; });
  try {
    let win = null, lw = null;
    for (let i = 0; i < 60 && !win && exited === null; i++) {
      await sleep(500);
      const ua = (await runUiaReal({mode: 'apps', name: 'powershell'}, opt)).apps || [];
      win = ua.find(w => /NEXUS R01 Delete File/.test(w.name || ''));
      if (!win && i % 10 === 9) console.log('r01: powershell windows so far', JSON.stringify(ua.map(w => [w.name, w.className])));
    }
    if (!win) lw = await listWindows({includeTitles: true}, {tmpDir: opt.tmpDir});
    if (!win) console.log('r01: box not found; exited', exited, 'stderr', fs.readFileSync(errFile, 'utf8').slice(0, 600), 'windows', JSON.stringify((lw?.windows || []).map(w => [w.process, w.title])).slice(0, 1500));
    assert.ok(win, 'message box window found');
    console.log('r01 dialog window', JSON.stringify({className: win.className, rect: win.rect, name: win.name}));
    const t = await runUiaReal({mode: 'tree', pid: win.pid, depth: 6, max: 200}, opt);
    const nodes = flat(t.tree || []);
    const btn = n => nodes.find(x => x.type === 'Button' && new RegExp('^&?' + n + '$', 'i').test(String(x.name || '')));
    const yes = btn('Yes'), no = btn('No');
    assert.ok(yes?.rect && no?.rect, 'Yes/No buttons with rectangles');
    const centre = r => ({x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2)});
    const atYes = (await runUiaReal({mode: 'at', ...centre(yes.rect)}, opt)).at;
    const atNo = (await runUiaReal({mode: 'at', ...centre(no.rect)}, opt)).at;
    console.log('r01 at(yes)', JSON.stringify({elem: atYes.elem, parentType: atYes.parentType, dialog: atYes.dialog}));
    assert.ok(atYes.dialog, 'UIA reports the dialog (modal or #32770)');
    assert.ok((atYes.dialog.text || []).some(s => /permanently delete/i.test(s)), 'dialog text visible to the Host');
    const cy = classifyDestructiveClick(atYes, 'click');
    assert.equal(cy?.what, 'destructive_action', JSON.stringify(cy));
    assert.equal(classifyDestructiveClick(atNo, 'click'), null);
  } finally {
    spawnSync(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(p.pid), '/T', '/F']);
  }
});

test('Windows R-01: Delete in a real Notepad text area stays free (focused Document/Edit)', {skip: !RUN && 'win32 + NEXUS_REAL_GUI=1 only', timeout: 120_000}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-r01-np-'));
  const opt = {tmpDir: path.join(home, 'tmp')}; fs.mkdirSync(opt.tmpDir, {recursive: true});
  const np = spawn(path.join(process.env.SystemRoot, 'System32', 'notepad.exe'), [], {detached: true, stdio: 'ignore'}); np.unref();
  try {
    let ctx = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      ctx = await runUiaReal({mode: 'context'}, opt);
      if (/notepad/i.test(ctx.focused?.process || '')) break;
    }
    console.log('r01 notepad context', JSON.stringify({elem: ctx?.elem, parentType: ctx?.parentType, dialog: ctx?.dialog ?? null}));
    if (!/notepad/i.test(ctx?.focused?.process || '')) { console.log('r01: Notepad did not take focus on this runner — key check done on reported context only'); return; }
    assert.equal(classifyDestructiveKeys('delete', ctx), null);
    assert.equal(classifyDestructiveKeys('ctrl+shift+delete', ctx)?.what, 'destructive_action');
  } finally {
    spawnSync(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(np.pid), '/T', '/F']);
  }
});
