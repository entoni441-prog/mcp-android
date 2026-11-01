// REAL Windows end-to-end for 0.4.0 GUI tools: PowerShell 5.1 UIA + Java Robot + Notepad.
// Runs only on win32 with NEXUS_REAL_GUI=1 (GitHub windows runner). Not a substitute for the owner's PC acceptance.
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

test('Windows: window_info, focus, keyboard, inspect, mouse allow/deny, capture — on a real Notepad', {skip: !RUN && 'win32 + NEXUS_REAL_GUI=1 only', timeout: 240_000}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-win-real-'));
  const caps = validateCapabilities({gui_input: true});
  const gui = createGui({caps, home, workspace: path.join(home, 'ws'), platform: 'win32'});
  const before = new Set((await listWindows({}, {tmpDir: home})).windows.map(w => w.pid));
  spawn(path.join(process.env.SystemRoot, 'System32', 'notepad.exe'), [], {detached: true, stdio: 'ignore'}).unref();
  let pid = null, pid2 = null;
  for (let i = 0; i < 30 && !pid; i++) {
    await sleep(500);
    pid = (await listWindows({}, {tmpDir: home})).windows.find(w => /^notepad$/i.test(w.process) && !before.has(w.pid))?.pid ?? null;
  }
  assert.ok(pid, 'notepad window not found');
  try {
    const info = await gui.window_info({pid});
    console.log('window_info', JSON.stringify(info));
    assert.ok(info.windows.length >= 1 && info.coordinateMapping === true);

    // Second Notepad takes the foreground; focus_window must switch back to the first one via AppActivate.
    spawn(path.join(process.env.SystemRoot, 'System32', 'notepad.exe'), [], {detached: true, stdio: 'ignore'}).unref();
    for (let i = 0; i < 30 && !pid2; i++) { await sleep(500); pid2 = (await listWindows({}, {tmpDir: home})).windows.find(w => /^notepad$/i.test(w.process) && !before.has(w.pid) && w.pid !== pid)?.pid ?? null; }
    await sleep(800);
    console.log('second notepad', pid2, 'first is foreground:', (await gui.window_info({pid})).foreground);
    const f = await gui.focus_window({pid});
    console.log('focus_window', JSON.stringify(f));
    assert.equal(f.focused, true, 'focus not confirmed: ' + JSON.stringify(f));
    assert.equal((await gui.window_info({pid})).foreground, true);

    const tree = await gui.inspect_ui({pid, maxDepth: 3});
    console.log('inspect_ui nodes', tree.nodes, JSON.stringify(tree.tree).slice(0, 600));
    const flat = []; const walk = n => { flat.push(n); (n.children || []).forEach(walk); }; tree.tree.forEach(walk);
    const edit = flat.find(n => (['Edit', 'Document'].includes(n.type) || /edit/i.test(n.className || '')) && n.rect && n.rect.w > 50)
      || flat.filter(n => n.type !== 'Window' && n.rect).sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0];
    console.log('edit target', JSON.stringify(edit));
    assert.ok(edit, 'edit control not found');

    const k = await gui.keyboard_action({text: 'NEXUS 0.4.0 тест'});
    console.log('keyboard_action', JSON.stringify(k));
    await sleep(500);
    const title = (await gui.window_info({pid})).windows[0].name;
    console.log('title after typing', title);
    assert.match(title, /^\*|●|•/, 'Notepad did not become modified');

    const cx = edit.rect.x + Math.floor(edit.rect.w / 2), cy = edit.rect.y + Math.floor(edit.rect.h / 2);
    const m = await gui.mouse_action({action: 'click', x: cx, y: cy});
    console.log('mouse_action inside', JSON.stringify(m));
    assert.match(m.target.process, /^notepad$/i);

    const w = info.windows[0].rect;
    const outside = [[w.x + w.w + 40, w.y + 40], [w.x - 40, w.y + 40], [w.x + 40, w.y + w.h + 40]].find(([x, y]) => x > 5 && y > 5 && x < 1900 && y < 1000);
    const denied = await gui.mouse_action({action: 'click', x: outside[0], y: outside[1]}).then(r => r, e => e);
    console.log('mouse_action outside', outside, denied instanceof Error ? denied.message : JSON.stringify(denied));
    assert.ok(denied instanceof Error && /target_not_allowed/.test(denied.message), 'click outside Notepad must be refused');

    const cap = await gui.capture_screen({maxWidth: 800});
    console.log('capture_screen', JSON.stringify(cap.structured));
    assert.equal(cap.content[0].type, 'image');
    assert.ok(cap.structured.distinctColours > 1);
  } finally {
    for (const p of [pid, pid2]) if (p) spawnSync(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/pid', String(p), '/f']);
    gui.stop();
  }
});
