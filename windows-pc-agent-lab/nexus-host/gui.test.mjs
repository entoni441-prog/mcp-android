// Unit tests for gui.mjs with fake UIA + fake Robot (all platforms).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {createGui, mapping, testPng} from './gui.mjs';
import {validateCapabilities} from './capabilities.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-gui-'));
const ROOT = {x: 0, y: 0, w: 1920, h: 1080};            // UIA space (physical, 150 %)
const INFO = {x: 0, y: 0, w: 1280, h: 720, screens: 1}; // Java logical points

function fakes({at = {pid: 50, process: 'Notepad'}, focused = {ok: true, pid: 50, process: 'Notepad'}, root = ROOT, info = INFO, activateFocus} = {}) {
  const uiaCalls = [], robotCmds = [];
  const uia = async a => {
    uiaCalls.push(a);
    const base = {root};
    if (a.mode === 'focused') return {...base, focused};
    if (a.mode === 'context') return {...base, focused, elem: {controlType: 'Document', name: '', id: ''}, window: {hwnd: 500, pid: focused.pid, process: focused.process, name: 'Untitled - Notepad', tabs: []}};
    if (a.mode === 'apps') return {...base, apps: []};
    if (a.mode === 'at') return {...base, at: {...at, controlType: 'ControlType.Document'}, focused};
    if (a.mode === 'windows') return {...base, target: {pid: a.pid, process: a.pid === 50 ? 'Notepad' : a.pid === 66 ? 'powershell' : 'Other'}, windows: [{name: 'Untitled - Notepad', className: 'Notepad', hwnd: 500, rect: {x: 300, y: 150, w: 900, h: 600}}], focused};
    if (a.mode === 'activate') return {...base, target: {pid: a.pid, process: 'Notepad'}, appActivateByPid: true, windowFound: true, setFocus: true, focused: activateFocus ?? {ok: true, pid: a.pid, process: 'Notepad'}};
    if (a.mode === 'tree') return {...base, target: {pid: a.pid, process: a.pid === 50 ? 'Notepad' : 'cmd'}, nodes: 2, tree: [{type: 'Window', name: 'N', rect: {x: 300, y: 150, w: 900, h: 600}, children: [{type: 'Document', name: '', rect: {x: 330, y: 240, w: 840, h: 480}}]}]};
    throw Error('bad mode');
  };
  const robot = {cmd: async c => { robotCmds.push(c); if (c === 'info') return info; if (c.startsWith('paste')) return {pasted: 1, clipboardRestored: true};
    if (c.startsWith('capture')) { const file = Buffer.from(c.split(' ')[2], 'base64').toString(); fs.writeFileSync(file, testPng(8)); return {screenW: 1280, screenH: 720, imageW: 1280, imageH: 720, colours: 200, ms: 5}; }
    return {ok: true}; }, start: async () => {}, stop() {}};
  return {uia, robot, uiaCalls, robotCmds};
}
const caps = (o = {}) => validateCapabilities({gui_input: true, ...o});
const gui = (f, o) => createGui({caps: caps(o), home: tmp, workspace: path.join(tmp, 'ws'), platform: 'win32', runUia: f.uia, robot: f.robot});

test('mapping: Java logical ↔ UIA physical at 150 %', () => {
  const m = mapping(INFO, ROOT);
  assert.deepEqual(m.toUia(100, 200), {x: 150, y: 300});
  assert.deepEqual(m.rectToScreen({x: 300, y: 150, w: 900, h: 600}), {x: 200, y: 100, w: 600, h: 400});
  assert.equal(mapping({...INFO, screens: 2}, ROOT), null);
});

test('input tools are refused unless gui_input is enabled', async () => {
  const f = fakes();
  const g = createGui({caps: validateCapabilities({gui_input: false}), home: tmp, workspace: tmp, platform: 'win32', runUia: f.uia, robot: f.robot});
  await assert.rejects(g.mouse_action({action: 'click', x: 10, y: 10}), /capability_disabled/);
  await assert.rejects(g.keyboard_action({text: 'x'}), /capability_disabled/);
  assert.equal(f.robotCmds.length, 0);
});

test('mouse click on allowlisted app: checked point mapped to UIA space, then Robot gets screen points', async () => {
  const f = fakes();
  const r = await gui(f).mouse_action({action: 'click', x: 400, y: 300});
  assert.equal(r.target.process, 'Notepad');
  const at = f.uiaCalls.find(c => c.mode === 'at');
  assert.deepEqual([at.x, at.y], [600, 450]);
  assert.ok(f.robotCmds.includes('click 400 300 left 1'));
});

test('mouse refused over a terminal, UAC, shell UI or unknown target; Robot never called', async () => {
  for (const proc of ['powershell', 'WindowsTerminal', 'cmd', 'consent', 'ApplicationFrameHost', 'SearchHost', '']) {
    const f = fakes({at: {pid: 9, process: proc}});
    await assert.rejects(gui(f).mouse_action({action: 'click', x: 1, y: 1}), /target_not_allowed/, proc);
    assert.ok(!f.robotCmds.some(c => c.startsWith('click')), proc);
  }
});

test('0.5.2 allowlist mode (owner fallback) keeps the 0.5.1 behaviour: non-listed apps refused', async () => {
  for (const proc of ['explorer', 'chrome', 'Code']) {
    const f = fakes({at: {pid: 9, process: proc}});
    await assert.rejects(gui(f, {appAccess: 'allowlist'}).mouse_action({action: 'click', x: 1, y: 1}), /target_not_allowed: not_in_allowlist/, proc);
    assert.ok(!f.robotCmds.some(c => c.startsWith('click')), proc);
  }
});

test('0.5.2 N-01: ordinary apps, explorer and IDE need no allowlist in policy mode', async () => {
  for (const proc of ['chrome', 'explorer', 'mspaint', 'Code', 'WINWORD']) {
    const f = fakes({at: {pid: 9, process: proc}});
    const r = await gui(f).mouse_action({action: 'click', x: 1, y: 1});
    assert.equal(r.done, true, proc);
  }
});

test('0.5.2: owner-blocked app is refused even in policy mode', async () => {
  const f = fakes({at: {pid: 9, process: 'chrome'}});
  await assert.rejects(gui(f, {blockedApps: ['chrome']}).mouse_action({action: 'click', x: 1, y: 1}), /target_not_allowed: blocked_by_owner/);
  assert.ok(!f.robotCmds.some(c => c.startsWith('click')));
});

test('0.5.2 N-02: input/reading in a password manager needs one-time consent; replay runs once for that window only', async () => {
  const {createConsent} = await import('./consent.mjs');
  const consent = createConsent();
  const f = fakes({at: {pid: 9, process: 'Bitwarden', window: {hwnd: 77, name: 'Bitwarden'}}});
  const g = createGui({caps: caps(), home: tmp, workspace: tmp, platform: 'win32', runUia: f.uia, robot: f.robot, consent});
  const r = await g.mouse_action({action: 'click', x: 1, y: 1});
  assert.equal(r.status, 'consent_required'); assert.equal(r.what, 'protected_app');
  assert.match(r.target, /защищённое приложение — Bitwarden/);
  assert.ok(!f.robotCmds.some(c => c.startsWith('click')), 'nothing sent before consent');
  const p = consent.take(r.consentId, 'allow', r.target);
  const out = await p.apply();
  assert.equal(out.done, true);
  assert.equal(f.robotCmds.filter(c => c.startsWith('click')).length, 1);
  assert.throws(() => consent.take(r.consentId, 'allow', r.target), /expired_or_unknown/, 'single use');
  // focusing a protected app is allowed (showing it to the owner is not reading it)
  const f2 = fakes(); const uia0 = f2.uia;
  f2.uia = async a => (a.mode === 'windows' ? {...(await uia0(a)), target: {pid: a.pid, process: 'Bitwarden'}} : uia0(a));
  const g2 = createGui({caps: caps(), home: tmp, workspace: tmp, platform: 'win32', runUia: f2.uia, robot: f2.robot, consent});
  assert.equal((await g2.window_info({pid: 9})).status, 'consent_required', 'window titles of a vault = reading');
});

test('0.5.2 IDE: typing into the VS Code terminal or pressing F5 needs consent; editing code does not', async () => {
  const {createConsent} = await import('./consent.mjs');
  const mk = elem => {
    const f = fakes({focused: {ok: true, pid: 70, process: 'Code'}}); const uia0 = f.uia;
    f.uia = async a => (a.mode === 'context' ? {...(await uia0(a)), elem} : uia0(a));
    return {f, g: createGui({caps: caps(), home: tmp, workspace: tmp, platform: 'win32', runUia: f.uia, robot: f.robot, consent: createConsent()})};
  };
  let {f, g} = mk({controlType: 'Edit', name: 'Terminal 1, powershell'});
  let r = await g.keyboard_action({text: 'npm publish'});
  assert.equal(r.what, 'arbitrary_command'); assert.match(r.target, /ввод текста «npm publish»/);
  assert.ok(!f.robotCmds.some(c => c.startsWith('paste')));
  ({f, g} = mk({controlType: 'Edit', name: 'Editor content;Press Alt+F1'}));
  assert.equal((await g.keyboard_action({keys: 'f5'})).what, 'arbitrary_command');
  assert.equal((await g.keyboard_action({text: 'const x = 1;\n'})).done, true);
  assert.equal((await g.keyboard_action({keys: 'ctrl+s'})).done, true);
});

test('hard-denied apps cannot be allowlisted via capabilities.json', async () => {
  const f = fakes({at: {pid: 9, process: 'powershell'}});
  await assert.rejects(gui(f, {inputApps: ['powershell', 'Notepad']}).mouse_action({action: 'click', x: 1, y: 1}), /target_not_allowed/);
});

test('drag checks both end points', async () => {
  const f = fakes();
  let n = 0; const uia0 = f.uia;
  f.uia = async a => { if (a.mode === 'at' && ++n === 2) return {root: ROOT, at: {pid: 1, process: 'cmd'}}; return uia0(a); };
  await assert.rejects(gui(f).mouse_action({action: 'drag', x: 1, y: 1, x2: 500, y2: 500}), /target_not_allowed/);
  assert.ok(!f.robotCmds.some(c => c.startsWith('drag')));
});

test('screen geometry change between calls aborts the action', async () => {
  const f = fakes(); let root = null; const uia0 = f.uia;
  f.uia = async a => { const r = await uia0(a); return root ? {...r, root} : r; };
  const g = gui(f);
  await g.mouse_action({action: 'move', x: 5, y: 5});
  root = {x: 0, y: 0, w: 2560, h: 1440};
  await assert.rejects(g.mouse_action({action: 'click', x: 5, y: 5}), /screen_changed_retry/);
});

test('multi-monitor: no monitor map / mixed DPI refused; same DPI maps by scale; secondary-monitor point refused', async () => {
  const f = fakes({info: {...INFO, screens: 2}});
  await assert.rejects(gui(f).mouse_action({action: 'click', x: 1, y: 1}), /multi_monitor_mixed_dpi_unsupported/);
  const mixed = {...INFO, screens: 2, monitors: [{x: 0, y: 0, w: 1280, h: 720, scale: 1.5, primary: true}, {x: 1280, y: 0, w: 1920, h: 1080, scale: 1, primary: false}]};
  await assert.rejects(gui(fakes({info: mixed})).mouse_action({action: 'click', x: 1, y: 1}), /multi_monitor_mixed_dpi_unsupported/);
  const same = {...INFO, screens: 2, monitors: [{x: 0, y: 0, w: 1280, h: 720, scale: 1.5, primary: true}, {x: 1280, y: 0, w: 1280, h: 720, scale: 1.5, primary: false}]};
  const m = mapping(same, ROOT);
  assert.deepEqual(m.toUia(100, 10), {x: 150, y: 15}); assert.deepEqual(m.rectToScreen({x: 150, y: 15, w: 30, h: 30}), {x: 100, y: 10, w: 20, h: 20});
  await assert.rejects(gui(fakes({info: same})).mouse_action({action: 'click', x: 1300, y: 10}), /point_on_secondary_monitor/);
});

test('mouse argument validation', async () => {
  const g = gui(fakes());
  for (const a of [{action: 'click', x: 1}, {action: 'click', x: 1.5, y: 1}, {action: 'fly', x: 1, y: 1}, {action: 'scroll', x: 1, y: 1},
    {action: 'click', x: 1, y: 1, amount: 3}, {action: 'drag', x: 1, y: 1}, {action: 'click', x: 1, y: 1, cmd: 'x'}]) {
    await assert.rejects(g.mouse_action(a), /invalid_args/, JSON.stringify(a));
  }
});

test('keyboard: text goes via paste (base64), chord via key; focus must be allowlisted', async () => {
  const f = fakes();
  const r = await gui(f).keyboard_action({text: 'Привет, NEXUS'});
  assert.equal(r.target, 'Notepad');
  assert.ok(f.robotCmds.includes('paste ' + Buffer.from('Привет, NEXUS').toString('base64')));
  await gui(f).keyboard_action({keys: 'ctrl+s'});
  assert.ok(f.robotCmds.includes('key ctrl+s'));
  const f2 = fakes({focused: {ok: true, pid: 3, process: 'WindowsTerminal'}});
  await assert.rejects(gui(f2).keyboard_action({text: 'dir'}), /focus_not_allowed/);
  const f3 = fakes({focused: {ok: false}}); // UAC secure desktop / UIA failure → fail closed
  await assert.rejects(gui(f3).keyboard_action({keys: 'enter'}), /focus_not_allowed/);
  assert.equal(f2.robotCmds.length + f3.robotCmds.length, 0);
});

test('keyboard: Windows key, Ctrl+Alt chords, unknown keys and both/neither fields refused', async () => {
  const g = gui(fakes());
  for (const a of [{keys: 'win+r'}, {keys: 'meta+r'}, {keys: 'ctrl+alt+delete'}, {keys: 'alt+ctrl+t'}, {keys: 'ctrl+ä'}, {keys: 'ctrl+shift+alt+ctrl+a'},
    {}, {text: 'a', keys: 'enter'}, {text: ''}, {text: 'x'.repeat(4001)}]) await assert.rejects(g.keyboard_action(a), /invalid_args/, JSON.stringify(a));
});

test('focus_window: only allowlisted apps; success is confirmed by UIA, not by the return value', async () => {
  const g = gui(fakes({focused: {ok: true, pid: 1, process: 'explorer'}}));
  assert.equal((await g.focus_window({pid: 50})).focused, true);
  await assert.rejects(g.focus_window({pid: 66}), /app_not_allowed/);
  const g2 = gui(fakes({focused: {ok: true, pid: 1, process: 'explorer'}, activateFocus: {ok: true, pid: 1, process: 'explorer'}}));
  const r = await g2.focus_window({pid: 50});
  assert.equal(r.focused, false);
  assert.equal(r.attempts[0].method, 'UIA.SetFocus+AppActivate'); assert.equal(r.attempts[0].byPid, true);
  assert.equal(r.cause, 'foreground_lock_likely');
});

test('inspect_ui / window_info map rectangles to screen points and refuse other apps', async () => {
  const g = gui(fakes());
  const t = await g.inspect_ui({pid: 50});
  assert.deepEqual(t.tree[0].rect, {x: 200, y: 100, w: 600, h: 400});
  assert.deepEqual(t.tree[0].children[0].rect, {x: 220, y: 160, w: 560, h: 320});
  await assert.rejects(g.inspect_ui({pid: 77}), /app_not_allowed/);
  const w = await g.window_info({pid: 50});
  assert.deepEqual(w.windows[0].rect, {x: 200, y: 100, w: 600, h: 400});
});

test('capture_screen returns MCP image content + metadata, temp file removed, optional workspace copy', async () => {
  const f = fakes();
  const r = await gui(f).capture_screen({saveToWorkspace: true});
  assert.equal(r.content[0].type, 'image');
  assert.equal(r.content[0].mimeType, 'image/png');
  assert.equal(r.structured.imageToScreen, 1);
  assert.match(r.structured.savedTo, /^screenshots\/.+\.png$/);
  assert.deepEqual(fs.readdirSync(path.join(tmp, 'tmp')).filter(n => n.startsWith('cap-')), []);
  await assert.rejects(createGui({caps: validateCapabilities({screen_capture: false}), home: tmp, workspace: tmp, platform: 'win32', runUia: f.uia, robot: f.robot}).capture_screen({}), /capability_disabled/);
});

test('image_selftest PNG is valid (signature, IHDR, CRCs, pixels)', async () => {
  const r = await gui(fakes()).image_selftest({});
  const png = Buffer.from(r.content[0].data, 'base64');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 64);
  const idatLen = png.readUInt32BE(33);
  const raw = zlib.inflateSync(png.subarray(41, 41 + idatLen));
  const px = (x, y) => [...raw.subarray(y * 193 + 1 + x * 3, y * 193 + 4 + x * 3)];
  assert.deepEqual(px(0, 0), [250, 250, 250]);   // top-left white
  assert.deepEqual(px(63, 0), [40, 80, 255]);    // top-right blue
  assert.deepEqual(px(0, 63), [40, 200, 40]);    // bottom-left green
  assert.deepEqual(px(63, 63), [255, 40, 40]);   // bottom-right red
});

test('non-Windows platforms refuse GUI tools', async () => {
  const f = fakes();
  const g = createGui({caps: caps(), home: tmp, workspace: tmp, platform: 'linux', runUia: f.uia, robot: f.robot});
  await assert.rejects(g.capture_screen({}), /windows_only/);
  await assert.rejects(g.mouse_action({action: 'move', x: 1, y: 1}), /windows_only/);
});

test('0.5.2 N-03: input into a shell / credential prompt → Owner Handoff (no keys sent); reads and system processes stay refused', async () => {
  const specs = [];
  const mk = proc => { const f = fakes({focused: {ok: true, pid: 77, process: proc}});
    return {f, g: createGui({caps: caps(), home: tmp, workspace: tmp, platform: 'win32', runUia: f.uia, robot: f.robot, handoff: s => { specs.push(s); return {status: 'owner_action_required', handoffId: 'h-test'}; }})}; };
  for (const [proc, reason] of [['cmd', 'shell_command'], ['CredentialUIBroker', 'credential_prompt'], ['consent', 'uac_or_logon']]) {
    const {f, g} = mk(proc);
    const r = await g.keyboard_action({text: 'dir'});
    assert.equal(r.status, 'owner_action_required', proc); assert.equal(specs.at(-1).reason, reason);
    assert.equal(f.robotCmds.filter(c => c.startsWith('paste') || c.startsWith('key')).length, 0, 'nothing typed');
  }
  await assert.rejects(mk('svchost').g.keyboard_action({text: 'x'}), /focus_not_allowed/);
  // without a handoff dependency → the 0.5.1 refusal is unchanged
  const f2 = fakes({focused: {ok: true, pid: 77, process: 'cmd'}});
  await assert.rejects(gui(f2).keyboard_action({text: 'dir'}), /focus_not_allowed/);
});
