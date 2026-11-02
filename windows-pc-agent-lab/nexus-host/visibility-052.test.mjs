// Owner requirement 02.11.2026 — VISIBILITY & WINDOW LIFECYCLE: owner-activity guard, NEXUS window tracking,
// own-window limit, activity journal + Live View caption, STOP from the phone stops the task.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGui} from './gui.mjs';
import {createConsent} from './consent.mjs';
import {validateCapabilities} from './capabilities.mjs';
import {createSession} from './session.mjs';
import {createLive} from './live.mjs';
import {createApps, MAX_OWN_WINDOWS} from './apps.mjs';
import {journalTarget} from './server.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-vis-'));
const ROOT = {x: 0, y: 0, w: 1280, h: 720};
const INFO = {x: 0, y: 0, w: 1280, h: 720, screens: 1};

/** Fake desktop: NEXUS's Notepad (pid 50, hwnd 900) and the owner's Word (pid 70, hwnd 700); pointer settable. */
function desk() {
  const st = {fg: 'nexus', ptr: {x: 10, y: 10}, t: 1_000_000, cmds: []};
  const W = {nexus: {pid: 50, process: 'Notepad', hwnd: 900}, owner: {pid: 70, process: 'WINWORD', hwnd: 700}};
  const focused = () => ({ok: true, pid: W[st.fg].pid, process: W[st.fg].process, topHwnd: W[st.fg].hwnd});
  const win = () => ({hwnd: W[st.fg].hwnd, pid: W[st.fg].pid, process: W[st.fg].process, name: 'w', tabs: []});
  const el = {controlType: 'Document', name: '', id: ''};
  const uia = async a => {
    switch (a.mode) {
      case 'focused': return {root: ROOT, focused: focused()};
      case 'context': return {root: ROOT, focused: focused(), elem: el, window: win()};
      case 'at': return {root: ROOT, at: {pid: W[st.fg].pid, process: W[st.fg].process, controlType: 'ControlType.Document', elem: el, window: win()}, focused: focused()};
      case 'apps': return {root: ROOT, apps: [win()]};
      default: throw Error('mode ' + a.mode);
    }
  };
  const robot = {start: async () => {}, stop() {}, cmd: async c => {
    st.cmds.push(c);
    if (c === 'info') return INFO;
    if (c === 'pointer') return {...st.ptr};
    const m = /^(?:click|move) (\d+) (\d+)/.exec(c); if (m) st.ptr = {x: +m[1], y: +m[2]};
    return {ok: true};
  }};
  const g = createGui({caps: validateCapabilities({gui_input: true}), home: tmp, workspace: tmp, platform: 'win32', runUia: uia, robot,
    consent: createConsent(), sleep: async () => {}, now: () => st.t});
  return {st, g};
}

test('owner moves the mouse → NEXUS input paused (owner_active), resumes after the mouse rests 3 s; nothing sent meanwhile', async () => {
  const {st, g} = desk();
  assert.equal((await g.mouse_action({action: 'click', x: 100, y: 100})).done, true);
  st.ptr = {x: 600, y: 400}; // the owner grabs the mouse
  const sentBefore = st.cmds.filter(c => /^(click|key|paste|move)/.test(c)).length;
  await assert.rejects(g.mouse_action({action: 'click', x: 120, y: 100}), /^Error: owner_active: the owner is using the mouse/);
  await assert.rejects(g.keyboard_action({text: 'x'}), /owner_active/);
  st.t += 1500; await assert.rejects(g.mouse_action({action: 'click', x: 120, y: 100}), /owner_active/, 'not quiet long enough');
  st.ptr = {x: 650, y: 420}; st.t += 3500; await assert.rejects(g.mouse_action({action: 'click', x: 120, y: 100}), /owner_active/, 'still moving');
  assert.equal(st.cmds.filter(c => /^(click|key|paste|move)/.test(c)).length, sentBefore, 'no input while the owner is active');
  st.t += 3100; // mouse still for > 3 s
  assert.equal((await g.mouse_action({action: 'click', x: 120, y: 100})).done, true);
});

test('owner switches to another app → typing refused (never into the owner\'s window); explicit focus_window takes it back', async () => {
  const {st, g} = desk();
  assert.equal((await g.keyboard_action({text: 'a'})).done, true); // NEXUS works in Notepad
  st.fg = 'owner';
  await assert.rejects(g.keyboard_action({text: 'b'}), /owner_active: the foreground window is now WINWORD/);
  assert.ok(!st.cmds.some(c => c.startsWith('paste ') && st.cmds.indexOf(c) > 3), 'nothing typed into Word');
  g.forgetNexusWindow(); // e.g. open_app created a new NEXUS window → next input adopts the foreground
  assert.equal((await g.keyboard_action({text: 'c'})).done, true);
  g.resetFocusState(); // session end
});

test('session journal: names/codes only; caption ASCII; arguments and paths never recorded', () => {
  let t = 5_000_000;
  const s = createSession({caps: {live_view: true}, now: () => t, setIntervalFn: () => ({unref() {}}), clearIntervalFn: () => {}});
  s.note({tool: 'keyboard_action', ok: true, target: 'Notepad'});
  s.note({tool: 'read_text', ok: false, code: 'consent_required: protected_file C:\\Users\\x\\.env', target: 'C:\\Users\\x\\.env'});
  const a = s.activity();
  assert.deepEqual(a.map(e => [e.tool, e.ok, e.code ?? null, e.target ?? null]), [['keyboard_action', true, null, 'Notepad'], ['read_text', false, 'consent_required', null]]);
  t += 2000;
  assert.equal(s.caption(), 'NEXUS idle | read_text | ERROR consent_required | 2s ago');
  assert.ok(!JSON.stringify(s.status()).includes('Users'), 'no paths in status');
  assert.equal(journalTarget({target: {process: 'Notepad'}}, {}), 'Notepad');
  assert.equal(journalTarget(null, {app: 'explorer'}), 'explorer');
});

test('STOP on the phone (live_control stop) ends the task and refuses new work until resumed; viewing/status still allowed', async () => {
  let t = 1_000;
  const caps = {live_view: true};
  const s = createSession({caps, now: () => t, setIntervalFn: () => ({unref() {}}), clearIntervalFn: () => {}, audit: () => {}});
  let ended = null; s.onEnd(async r => { ended = r; return {}; }, 'probe');
  await s.around('mouse_action', async () => 'ok');
  assert.equal(s.active(), true);
  const live = createLive({caps, store: {set() {}}, capture: async () => ({jpeg: Buffer.alloc(1), meta: {}}), session: s, indicator: () => {}, setIntervalFn: () => ({unref() {}})});
  const r = live.live_control({action: 'stop'});
  assert.equal(r.taskStopped, true);
  await new Promise(res => setImmediate(res));
  assert.equal(ended, 'owner_stop'); assert.equal(s.active(), false);
  await assert.rejects(s.around('keyboard_action', async () => 'typed'), /^Error: stopped_by_owner/);
  assert.equal(await s.around('inspect_ui', async () => 'read'), 'read', 'read-only tools still answer');
  assert.equal(s.status().stoppedByOwner, true);
  assert.match(s.caption(), /STOPPED BY OWNER/);
  t += 11 * 60_000; assert.equal(await s.around('keyboard_action', async () => 'typed'), 'typed', 'block expires (10 min)');
  await s.end('finish_task');
  live.live_control({action: 'stop'}); await new Promise(res => setImmediate(res));
  assert.equal(live.live_control({action: 'resume'}).resumed, true);
  assert.equal(await s.around('keyboard_action', async () => 'typed'), 'typed');
  live.stop?.(); s.stop();
});

test(`open_app refuses a ${MAX_OWN_WINDOWS + 1}rd own window (open → act → close); owner windows never count`, async () => {
  const consent = createConsent();
  consent.owned.apps.add('Notepad'); consent.owned.apps.add('CalculatorApp');
  consent.owned.windows.add('11'); consent.owned.windows.add('22');
  const snaps = {Notepad: [{hwnd: 11, tabs: []}, {hwnd: 99, tabs: [{rid: 'owner-tab'}]}], CalculatorApp: [{hwnd: 22, tabs: []}], explorer: []};
  const launched = [];
  const launcher = exe => { launched.push(exe); const h = {}; return {pid: 1, once: (ev, fn) => { if (ev === 'spawn') setImmediate(fn); return h; }, unref() {}}; };
  const gui = {snapshotApp: async app => snaps[app] ?? [], forgetNexusWindow() {}};
  const a = createApps({caps: validateCapabilities({}), store: null, consent, gui, workspace: tmp, platform: 'win32', systemRoot: 'C:\\Windows',
    launcher, exists: () => true, wait: async () => {}, discovery: {list: async () => [], find: async () => null}});
  await assert.rejects(a.open_app({app: 'explorer'}), /^Error: nexus_window_limit: NEXUS already has 2 of its own windows open \(Notepad, CalculatorApp\)/);
  assert.equal(launched.length, 0);
  snaps.CalculatorApp = []; // NEXUS closed the calculator
  assert.equal((await a.open_app({app: 'explorer'})).started, true);
});
