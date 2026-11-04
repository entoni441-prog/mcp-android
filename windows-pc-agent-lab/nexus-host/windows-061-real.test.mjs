// NEXUS 0.6.1 on a REAL Windows desktop (GitHub windows-latest): NX-052-32 — typing leaves the owner's clipboard
// untouched (all formats, incl. HTML and a private format Java cannot read); the typed text arrives exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {createGui} from './gui.mjs';
import {listWindows} from './windows.mjs';
import {validateCapabilities} from './capabilities.mjs';

const RUN = process.platform === 'win32' && process.env.NEXUS_REAL_GUI === '1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const ps = (script, env = {}) => { const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], {encoding: 'utf8', env: {...process.env, ...env}});
  if (r.status !== 0) throw Error('ps: ' + r.stderr); return r.stdout.trim(); };
// owner clipboard: plain text + HTML + a private format (Java AWT has no flavor for it)
const SET_CLIP = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.DataObject
$d.SetData([System.Windows.Forms.DataFormats]::UnicodeText, 'owner clip ✓')
$d.SetData([System.Windows.Forms.DataFormats]::Html, 'Version:0.9')
$ms = New-Object System.IO.MemoryStream (,[byte[]](1,2,3,4,5)); $d.SetData('NEXUS.Private.Format', $ms)
[System.Windows.Forms.Clipboard]::SetDataObject($d, $true)`;
const READ_CLIP = `Add-Type -AssemblyName System.Windows.Forms; $o = [System.Windows.Forms.Clipboard]::GetDataObject()
$p = $o.GetData('NEXUS.Private.Format'); $b = if ($p) { ($p.ToArray() -join ',') } else { 'none' }
@{text = [System.Windows.Forms.Clipboard]::GetText(); private = $b; html = $o.GetDataPresent([System.Windows.Forms.DataFormats]::Html)} | ConvertTo-Json -Compress`;
const READ_NOTEPAD = `Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$w = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$env:NX_PID)))
$c = New-Object System.Windows.Automation.OrCondition((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)), (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)))
$e = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)
$t = $null; try { $t = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch { $t = $e.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern).DocumentRange.GetText(-1) }
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t))`;

test('real Windows 0.6.1: keyboard_action types without the clipboard; owner clipboard intact (text, HTML, private); exact text', {skip: !RUN && 'win32 + NEXUS_REAL_GUI=1 only', timeout: 240_000}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-061-real-'));
  const gui = createGui({caps: validateCapabilities({}), home, workspace: path.join(home, 'ws'), platform: 'win32'});
  const before = new Set((await listWindows({}, {tmpDir: home})).windows.map(w => w.pid));
  spawn(path.join(process.env.SystemRoot, 'System32', 'notepad.exe'), [], {detached: true, stdio: 'ignore'}).unref();
  let pid = null;
  for (let i = 0; i < 30 && !pid; i++) { await sleep(500); pid = (await listWindows({}, {tmpDir: home})).windows.find(w => /^notepad$/i.test(w.process) && !before.has(w.pid))?.pid ?? null; }
  assert.ok(pid, 'notepad window not found');
  try {
    assert.equal((await gui.focus_window({pid})).focused, true);
    ps(SET_CLIP);
    const clipBefore = JSON.parse(ps(READ_CLIP));
    console.log('clipboard before', JSON.stringify(clipBefore));
    assert.equal(clipBefore.private, '1,2,3,4,5');
    const TEXT = 'NEXUS 0.6.1 тест {+}%^~ (x)[y] ü — ok';
    const k = await gui.keyboard_action({text: TEXT});
    console.log('keyboard_action', JSON.stringify(k));
    assert.equal(k.inputMethod, 'keys', 'typed as keystrokes, not via the clipboard: ' + (k.keysError || ''));
    assert.equal(k.clipboard, 'untouched'); assert.equal(k.clipboardRestored, true);
    await sleep(600);
    const clipAfter = JSON.parse(ps(READ_CLIP));
    console.log('clipboard after', JSON.stringify(clipAfter));
    assert.deepEqual(clipAfter, clipBefore, 'owner clipboard must stay exactly as it was');
    const typed = Buffer.from(ps(READ_NOTEPAD, {NX_PID: String(pid)}), 'base64').toString('utf8');
    console.log('notepad text', JSON.stringify(typed));
    assert.equal(typed.replace(/\r/g, ''), TEXT);
  } finally {
    spawnSync(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/pid', String(pid), '/f']);
    gui.stop();
  }
});
