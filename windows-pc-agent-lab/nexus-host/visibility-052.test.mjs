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
      case 'windows': return {root: ROOT, target: {pid: a.pid, process: W[st.fg].process}, windows: [win()]};
      case 'close': st.cmds.push('uia-close'); return {closed: true};
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
  let onOwner = () => {};
  const g = createGui({caps: validateCapabilities({gui_input: true}), home: tmp, workspace: tmp, platform: 'win32', runUia: uia, robot,
    consent: createConsent(), sleep: async () => {}, now: () => st.t, onOwnerActive: why => onOwner(why)});
  return {st, g, setOwnerActive: f => { onOwner = f; }};
}

/** desk() + a real session wired like server.mjs (gui → pauseForOwner, live resume → gui.ownerResumed). */
function deskSession() {
  const d = desk();
  const s = createSession({caps: {live_view: true}, now: () => d.st.t, setIntervalFn: () => ({unref() {}}), clearIntervalFn: () => {}});
  d.setOwnerActive(why => s.pauseForOwner(why));
  const live = createLive({caps: {live_view: true}, store: {set() {}}, capture: async () => ({jpeg: Buffer.alloc(1), meta: {}}), session: s,
    onResume: () => d.g.ownerResumed(), indicator: () => {}, setIntervalFn: () => ({unref() {}})});
  return {...d, s, live};
}

test('owner moves the mouse → owner_active and a STICKY pause: a still mouse (even 10 min) does not resume; only explicit resume does', async () => {
  const {st, g, s, live} = deskSession();
  assert.equal(await s.around('mouse_action', () => g.mouse_action({action: 'click', x: 100, y: 100})).then(r => r.done), true);
  st.ptr = {x: 600, y: 400}; // the owner grabs the mouse
  const sent = () => st.cmds.filter(c => /^(click|key|paste|move)/.test(c)).length;
  const sentBefore = sent();
  await assert.rejects(s.around('mouse_action', () => g.mouse_action({action: 'click', x: 120, y: 100})), /^Error: owner_active: the owner moved the mouse - NEXUS paused ALL input/);
  assert.equal(s.ownerPaused(), true);
  assert.match(s.caption(), /PAUSED, OWNER AT PC/);
  st.t += 10 * 60_000; // mouse untouched for 10 minutes — still paused
  for (const tool of ['mouse_action', 'keyboard_action', 'focus_window', 'open_app', 'close_window']) {
    await assert.rejects(s.around(tool, async () => 'ran'), /^Error: owner_paused: the owner took over the PC/, tool);
  }
  assert.equal(await s.around('inspect_ui', async () => 'read'), 'read', 'reading stays possible');
  assert.equal(sent(), sentBefore, 'no input while paused');
  assert.equal(s.status().ownerPaused.why, 'mouse');
  const r = live.live_control({action: 'resume'}); // only after the owner's go-ahead in chat
  assert.deepEqual([r.resumed, r.ownerPauseCleared], [true, true]);
  assert.equal((await s.around('mouse_action', () => g.mouse_action({action: 'click', x: 120, y: 100}))).done, true, 'current mouse position adopted after resume');
  s.stop(); live.stop?.();
});

test('owner switches to another app → typing refused, session paused; after resume NEXUS takes its window back only via focus_window', async () => {
  const {st, g, s, live} = deskSession();
  assert.equal((await s.around('keyboard_action', () => g.keyboard_action({text: 'a'}))).done, true); // NEXUS works in Notepad
  st.fg = 'owner';
  await assert.rejects(s.around('keyboard_action', () => g.keyboard_action({text: 'b'})), /owner_active: the foreground window is now WINWORD/);
  assert.equal(s.ownerPaused(), true);
  await assert.rejects(s.around('keyboard_action', () => g.keyboard_action({text: 'b'})), /owner_paused/);
  live.live_control({action: 'resume'});
  await assert.rejects(s.around('keyboard_action', () => g.keyboard_action({text: 'b'})), /owner_active: the foreground window is now WINWORD/, 'still never types into the owner\'s window');
  assert.ok(!st.cmds.some((c, i) => c.startsWith('paste ') && i > 3), 'nothing typed into Word');
  live.live_control({action: 'resume'});
  g.forgetNexusWindow(); // e.g. open_app created a new NEXUS window → next input adopts the foreground
  assert.equal((await s.around('keyboard_action', () => g.keyboard_action({text: 'c'}))).done, true);
  g.resetFocusState(); s.stop(); live.stop?.();
});

test('session end while the owner holds the PC: NEXUS windows are not touched (cleanup deferred); owner STOP still cleans up', async () => {
  const {st, g} = desk();
  g.consent.owned.windows.add('900'); g.consent.owned.apps.add('Notepad');
  const n = st.cmds.length;
  const r = await g.cleanupOwned('lease_expired', {ownerPaused: true});
  assert.equal(r.left[0].why, 'owner_at_pc_paused'); assert.equal(r.closed.length, 0);
  assert.equal(st.cmds.length, n, 'no robot input'); assert.equal(g.consent.owned.windows.has('900'), true, 'ownership kept for the next cleanup');
});

test('lifecycle: input → unverified; read after input → done; untouched windows; failed snapshot keeps state; order not time', async () => {
  const {createLifecycle} = await import('./lifecycle.mjs');
  const L = createLifecycle({now: () => 5}); // frozen clock: ordering must not depend on timestamps
  L.input({hwnd: 11, pid: 1, process: 'Notepad'});
  const P = [{app: 'Notepad', hwnd: 11}, {app: 'explorer', hwnd: 33}];
  assert.deepEqual(L.classify(P).unverified.map(w => w.hwnd), ['11']);
  assert.deepEqual(L.classify(P).untouched.map(w => w.hwnd), ['33']);
  L.observed({}); assert.deepEqual(L.classify(P).done.map(w => w.hwnd), ['11']);
  L.input({hwnd: 11, pid: 1}); assert.equal(L.unverified(11), true, 'new input after the check needs a new check');
  L.observed({pid: 2}); assert.equal(L.unverified(11), true, 'reading another process does not count');
  L.observed({pid: 1}); assert.equal(L.unverified(11), false);
  L.input({hwnd: 11, pid: 1});
  L.classify([], {prune: false}); assert.equal(L.unverified(11), true, 'a failed snapshot never drops the unchecked state');
  L.classify([]); assert.equal(L.unverified(11), false, 'window gone → forgotten');
});

test('close_window of a NEXUS window with unchecked input → nexus_verify_before_close (open → act → verify → close)', async () => {
  const {st, g} = desk();
  g.consent.owned.windows.add('900'); g.consent.owned.apps.add('Notepad'); g.consent.owned.pids.add(50);
  await g.keyboard_action({text: 'hello'});
  await assert.rejects(g.close_window({pid: 50}), /^Error: nexus_verify_before_close/);
  g.lifecycle.observed({pid: 50});
  await g.close_window({pid: 50}).catch(e => assert.doesNotMatch(String(e), /nexus_verify_before_close/));
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

test('open_app is sequential: unchecked work → nexus_window_unverified; checked but open → nexus_window_not_closed; a read-only window may stay', async () => {
  const {createLifecycle} = await import('./lifecycle.mjs');
  const consent = createConsent();
  consent.owned.apps.add('Notepad'); consent.owned.apps.add('explorer');
  consent.owned.windows.add('11'); consent.owned.windows.add('33');
  const snaps = {Notepad: [{hwnd: 11, tabs: []}], explorer: [{hwnd: 33, tabs: []}], CalculatorApp: []};
  const launched = [];
  const launcher = exe => { launched.push(exe); const h = {}; return {pid: 1, once: (ev, fn) => { if (ev === 'spawn') setImmediate(fn); return h; }, unref() {}}; };
  const lifecycle = createLifecycle();
  const gui = {snapshotApp: async app => snaps[app] ?? [], forgetNexusWindow() {}, lifecycle};
  const a = createApps({caps: validateCapabilities({}), store: null, consent, gui, workspace: tmp, platform: 'win32', systemRoot: 'C:\\Windows',
    launcher, exists: () => true, wait: async () => {}, discovery: {list: async () => [], find: async () => null}});
  lifecycle.input({hwnd: 11, pid: 5, process: 'Notepad'}); // worked in Notepad; Explorer (33) only read from
  await assert.rejects(a.open_app({app: 'explorer'}), /^Error: nexus_window_unverified: you worked in your Notepad pid 5 window/);
  lifecycle.observed({pid: 5});
  await assert.rejects(a.open_app({app: 'explorer'}), /^Error: nexus_window_not_closed: your Notepad pid 5 window is finished/);
  assert.equal(launched.length, 0);
  snaps.Notepad = []; // NEXUS closed it
  assert.ok(!/nexus_window_(unverified|not_closed)/.test(String(await a.open_app({app: 'explorer'}).catch(e => e))), 'untouched read-only window does not block');
});
