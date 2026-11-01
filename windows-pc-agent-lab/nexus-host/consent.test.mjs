// NEXUS 0.4.2 — owner consent for closing, NEXUS-created ownership, focus fallback (fake UIA + fake Robot).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGui} from './gui.mjs';
import {createConsent, classifyKeys, classifyClick} from './consent.mjs';
import {createProcs} from './procs.mjs';
import {validateCapabilities} from './capabilities.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-consent-'));
const ROOT = {x: 0, y: 0, w: 1280, h: 720};
const INFO = {x: 0, y: 0, w: 1280, h: 720, screens: 1};
const TAB = (rid, name, selected = false) => ({rid, name, selected});

/** Fake desktop: one Notepad window (hwnd 900) with tabs; element under the point is configurable. */
function desk({tabs = [TAB('u1', 'Текстовый документ.txt', true), TAB('u2', 'wrangler.jsonc')], el = {controlType: 'Document', name: '', id: ''}, tabAt = null, focusEl = {controlType: 'Document', name: '', id: ''}} = {}) {
  const st = {tabs, el, tabAt, focusEl, robot: [], hwnd: 900};
  const win = () => ({hwnd: st.hwnd, pid: 50, process: 'Notepad', name: 'Блокнот', tabs: st.tabs});
  const focused = {ok: true, pid: 50, process: 'Notepad', topHwnd: 900};
  st.uia = async a => {
    const base = {root: ROOT};
    switch (a.mode) {
      case 'focused': return {...base, focused};
      case 'context': return {...base, focused, elem: st.focusEl, window: win()};
      case 'at': return {...base, at: {pid: 50, process: 'Notepad', controlType: 'ControlType.' + st.el.controlType, elem: st.el, window: win(), ...(st.tabAt ? {tab: st.tabAt} : {})}, focused};
      case 'apps': return {...base, apps: [win()]};
      case 'windows': return {...base, target: {pid: a.pid, process: 'Notepad'}, windows: [{name: 'Блокнот', hwnd: 900, rect: {x: 100, y: 100, w: 800, h: 600}}], focused};
      default: throw Error('mode ' + a.mode);
    }
  };
  st.robot = {cmds: [], cmd: async c => { st.robot.cmds.push(c); if (c === 'info') return INFO; if (c === 'key ctrl+t') st.tabs = [...st.tabs.map(t => ({...t, selected: false})), TAB('n1', 'Без имени', true)]; return {ok: true}; }, start: async () => {}, stop() {}};
  return st;
}
const mk = (st, log = []) => {
  const consent = createConsent({audit: e => log.push(e)});
  return {log, consent, g: createGui({caps: validateCapabilities({gui_input: true}), home: tmp, workspace: tmp, platform: 'win32', runUia: a => st.uia(a), robot: {cmd: c => st.robot.cmd(c), start: async () => {}, stop() {}}, consent, sleep: async () => {}})};
};
const sent = st => st.robot.cmds.filter(c => c !== 'info');

test('classification: close chords, close/discard buttons, menu items; normal input is not a close', () => {
  const ctxTabs = {window: {tabs: [TAB('a', 'x', true)]}, elem: {controlType: 'Document'}};
  assert.deepEqual(classifyKeys('ctrl+w', ctxTabs).kind, 'tab');
  assert.deepEqual(classifyKeys('ctrl+w', {window: {tabs: []}}).kind, 'window');
  for (const k of ['alt+f4', 'ctrl+shift+w', 'shift+ctrl+w']) assert.equal(classifyKeys(k, ctxTabs).kind, 'window', k);
  for (const k of ['ctrl+s', 'enter', 'a', 'ctrl+n', 'esc', 'ctrl+f']) assert.equal(classifyKeys(k, ctxTabs), null, k);
  assert.equal(classifyKeys('enter', {elem: {controlType: 'Button', name: 'Не сохранять'}}).kind, 'discard');
  assert.equal(classifyKeys('enter', {elem: {controlType: 'Button', name: "Don't Save"}}).kind, 'discard');
  assert.equal(classifyKeys('enter', {elem: {controlType: 'MenuItem', name: 'Выход'}}).kind, 'window');
  assert.equal(classifyKeys('enter', {elem: {controlType: 'MenuItem', name: 'Закрыть вкладку'}}).kind, 'tab');
  assert.equal(classifyKeys('x', {elem: {controlType: 'MenuItem', name: 'Файл'}}).uncertain, true);
  assert.equal(classifyKeys('enter', {elem: {controlType: 'MenuItem', name: 'Сохранить'}}), null);
  assert.equal(classifyClick('click', {elem: {controlType: 'Button', name: 'Закрыть'}}).kind, 'window');
  assert.equal(classifyClick('click', {elem: {controlType: 'Button', name: 'Close'}}).kind, 'window');
  assert.equal(classifyClick('click', {elem: {controlType: 'Button', name: 'Закрыть вкладку'}, tab: {rid: 'a'}}).kind, 'tab');
  assert.equal(classifyClick('click', {elem: {controlType: 'Button', name: '', id: 'CloseButton'}, tab: {rid: 'a'}}).kind, 'tab');
  assert.equal(classifyClick('click', {elem: {controlType: 'MenuItem', name: 'Выход'}}).kind, 'window');
  assert.equal(classifyClick('click', {elem: {controlType: 'Button', name: 'Не сохранять'}}).kind, 'discard');
  assert.equal(classifyClick('click', {elem: {controlType: 'Document', name: 'Закрыть'}}), null);       // text in a document is not a button
  assert.equal(classifyClick('right_click', {elem: {controlType: 'Button', name: 'Закрыть'}}), null);
  assert.equal(classifyClick('click', {elem: {controlType: 'Button', name: 'Сохранить'}}), null);
});

test('owner tab: ctrl+w → consent_required, nothing sent; confirm with exact target executes once', async () => {
  const st = desk(); const {g, log} = mk(st);
  const r = await g.keyboard_action({keys: 'ctrl+w'});
  assert.equal(r.status, 'consent_required');
  assert.equal(r.target, 'Notepad: вкладка «Текстовый документ.txt»');
  assert.deepEqual(sent(st), []);
  const p = g.consent.take(r.consentId, 'close_discard', r.target);
  const done = await g.keyboard_action(p.replay.args, {consented: p, decision: 'close_discard'});
  assert.equal(done.done, true); assert.equal(done.consented, true);
  assert.deepEqual(sent(st), ['key ctrl+w']);
  assert.throws(() => g.consent.take(r.consentId, 'close_discard', r.target), /consent_expired_or_unknown/); // single use
  assert.ok(log.some(e => e.event === 'consent_required') && log.some(e => e.event === 'consent_decision'));
});

test('consent target must match exactly; wrong decision rejected; cancel does nothing', async () => {
  const st = desk(); const {g} = mk(st);
  const r = await g.keyboard_action({keys: 'alt+f4'});
  assert.equal(r.target, 'Notepad: окно «Блокнот»');
  assert.throws(() => g.consent.take(r.consentId, 'close_discard', 'Notepad: вкладка «другая»'), /consent_target_mismatch/);
  assert.throws(() => g.consent.take(r.consentId, 'yes', r.target), /invalid_args/);
  const p = g.consent.take(r.consentId, 'cancel', r.target);
  assert.equal(p.target, r.target);
  assert.deepEqual(sent(st), []);
});

test('consent expires after 120 s', () => {
  let t = 0; const c = createConsent({now: () => t});
  const r = c.gate({kind: 'window', via: 'x'}, {hwnd: 1, process: 'Notepad', name: 'w', tabs: []}, null, {tool: 'keyboard_action', args: {keys: 'alt+f4'}});
  t = 121_000;
  assert.throws(() => c.take(r.consentId, 'close_discard', r.target), /consent_expired_or_unknown/);
});

test('target changed between consent and confirm (other tab selected) → refused, nothing sent', async () => {
  const st = desk(); const {g} = mk(st);
  const r = await g.keyboard_action({keys: 'ctrl+w'});
  const p = g.consent.take(r.consentId, 'close_discard', r.target);
  st.tabs = [TAB('u1', 'Текстовый документ.txt'), TAB('u2', 'wrangler.jsonc', true)];
  await assert.rejects(g.keyboard_action(p.replay.args, {consented: p, decision: 'close_discard'}), /consent_target_changed/);
  assert.deepEqual(sent(st), []);
});

test('NEXUS-created tab (ctrl+t) is closed autonomously; window with owner tabs still needs consent', async () => {
  const st = desk(); const {g, log} = mk(st);
  const created = await g.keyboard_action({keys: 'ctrl+t'});
  assert.deepEqual(created.createdByNexus.tabs, ['Без имени']);
  const close = await g.keyboard_action({keys: 'ctrl+w'});
  assert.equal(close.done, true); assert.equal(close.closeAction, 'tab'); assert.equal(close.consented, false);
  assert.ok(log.some(e => e.event === 'close_autonomous'));
  const win = await g.keyboard_action({keys: 'alt+f4'});
  assert.equal(win.status, 'consent_required'); // the window still contains the owner's tabs
});

test('«Don\'t save» is allowed only right after an owned/consented close; otherwise consent', async () => {
  const st = desk({focusEl: {controlType: 'Button', name: 'Не сохранять'}}); const {g} = mk(st);
  const r = await g.keyboard_action({keys: 'enter'});
  assert.equal(r.status, 'consent_required'); assert.equal(r.kind, 'discard');
  assert.deepEqual(r.options, ['close_discard', 'cancel']);
  const st2 = desk(); const m2 = mk(st2);
  const c = await m2.g.keyboard_action({keys: 'ctrl+w'});
  const p = m2.consent.take(c.consentId, 'close_discard', c.target);
  await m2.g.keyboard_action(p.replay.args, {consented: p, decision: 'close_discard'});
  st2.focusEl = {controlType: 'Button', name: 'Не сохранять'};
  assert.equal((await m2.g.keyboard_action({keys: 'enter'})).done, true);  // armed by the consented close
  const st3 = desk(); const m3 = mk(st3);
  const c3 = await m3.g.keyboard_action({keys: 'ctrl+w'});
  const p3 = m3.consent.take(c3.consentId, 'close_save', c3.target);
  await m3.g.keyboard_action(p3.replay.args, {consented: p3, decision: 'close_save'});
  st3.focusEl = {controlType: 'Button', name: 'Не сохранять'};
  assert.equal((await m3.g.keyboard_action({keys: 'enter'})).status, 'consent_required'); // owner chose «save», not discard
});

test('mouse: click on tab close button / window Close / menu Exit gated; ordinary click passes', async () => {
  const st = desk({el: {controlType: 'Button', name: 'Закрыть вкладку', id: ''}, tabAt: {rid: 'u2', name: 'wrangler.jsonc'}}); const {g} = mk(st);
  const r = await g.mouse_action({action: 'click', x: 300, y: 110});
  assert.equal(r.status, 'consent_required'); assert.equal(r.target, 'Notepad: вкладка «wrangler.jsonc»');
  st.el = {controlType: 'Button', name: 'Закрыть', id: 'Close'}; st.tabAt = null;
  assert.equal((await g.mouse_action({action: 'click', x: 880, y: 105})).target, 'Notepad: окно «Блокнот»');
  st.el = {controlType: 'MenuItem', name: 'Выход', id: ''};
  assert.equal((await g.mouse_action({action: 'click', x: 120, y: 200})).status, 'consent_required');
  assert.deepEqual(sent(st).filter(c => c.startsWith('click')), []);
  st.el = {controlType: 'Document', name: '', id: ''};
  assert.equal((await g.mouse_action({action: 'click', x: 400, y: 400})).done, true);
});

test('process_action close: allowlisted app NEXUS did not start → consent; kill still only own processes', async () => {
  const consent = createConsent();
  const calls = [];
  const exec = async (exe, args) => { calls.push(args); return {code: 0, out: '"Notepad.exe","50","Console","1","10 K"\r\n"Notepad.exe","51","Console","1","10 K"'}; };
  const p = createProcs({caps: validateCapabilities({process_control: true}), cfg: {workspace: tmp, auditFile: path.join(tmp, 'a.log')}, platform: 'win32', systemRoot: 'C:\\Windows', exec, consent});
  const r = await p.process_action({pid: 50, action: 'close'});
  assert.equal(r.status, 'consent_required'); assert.equal(r.target, 'Notepad (pid 50)');
  assert.equal(calls.filter(a => a[0] === '/pid').length, 0);
  const t = consent.take(r.consentId, 'close_discard', r.target);
  assert.equal((await p.process_action(t.replay.args, {consented: t})).requested, true);
  consent.ownPid(51);
  assert.equal((await p.process_action({pid: 51, action: 'close'})).requested, true); // NEXUS-started: autonomous
  await assert.rejects(p.process_action({pid: 50, action: 'kill'}), /process_not_allowed/);
});

test('focus fallback: clicks only an empty spot of the target window title bar; never another window', async () => {
  const st = desk(); const {g} = mk(st);
  let fg = {ok: true, pid: 7, process: 'WindowsTerminal', topHwnd: 77};
  const uia0 = st.uia;
  st.uia = async a => {
    if (a.mode === 'windows') return {...(await uia0(a)), focused: fg};
    if (a.mode === 'activate') return {root: ROOT, appActivateByPid: true, focused: fg};
    if (a.mode === 'focused') return {root: ROOT, focused: fg};
    return uia0(a);
  };
  st.el = {controlType: 'TitleBar', name: '', id: ''};
  st.robot.cmd = async c => { st.robot.cmds.push(c); if (c === 'info') return INFO; if (c.startsWith('click')) fg = {ok: true, pid: 50, process: 'Notepad', topHwnd: 900}; return {}; };
  const r = await g.focus_window({pid: 50});
  assert.equal(r.focused, true, JSON.stringify(r)); assert.equal(r.method, 'titlebar_click');
  // covered by another window: the probe sees a foreign hwnd → no click at all
  const st2 = desk(); const m2 = mk(st2);
  const fg2 = {ok: true, pid: 7, process: 'WindowsTerminal', topHwnd: 77};
  const u2 = st2.uia;
  st2.uia = async a => a.mode === 'at' ? {root: ROOT, at: {pid: 7, process: 'WindowsTerminal', elem: {controlType: 'Pane'}, window: {hwnd: 77}}} :
    a.mode === 'activate' ? {root: ROOT, focused: fg2} : a.mode === 'windows' ? {...(await u2(a)), focused: fg2} : u2(a);
  const r2 = await m2.g.focus_window({pid: 50});
  assert.equal(r2.focused, false);
  assert.deepEqual(sent(st2).filter(c => c.startsWith('click')), []);
  // close button under the probe point is never clicked
  const st3 = desk({el: {controlType: 'Button', name: 'Закрыть', id: 'Close'}}); const m3 = mk(st3);
  const u3 = st3.uia;
  st3.uia = async a => a.mode === 'activate' ? {root: ROOT, focused: fg2} : a.mode === 'windows' ? {...(await u3(a)), focused: fg2} : u3(a);
  assert.equal((await m3.g.focus_window({pid: 50})).focused, false);
  assert.deepEqual(sent(st3).filter(c => c.startsWith('click')), []);
});

test('focus fallback is not used without gui_input', async () => {
  const st = desk();
  const fg = {ok: true, pid: 7, process: 'WindowsTerminal', topHwnd: 77};
  const u = st.uia;
  st.uia = async a => a.mode === 'activate' ? {root: ROOT, focused: fg} : a.mode === 'windows' ? {...(await u(a)), focused: fg} : u(a);
  const g = createGui({caps: validateCapabilities({}), home: tmp, workspace: tmp, platform: 'win32', runUia: st.uia, robot: st.robot, sleep: async () => {}});
  const r = await g.focus_window({pid: 50});
  assert.equal(r.focused, false); assert.match(r.hint, /gui_input/);
  assert.deepEqual(sent(st), []);
});
