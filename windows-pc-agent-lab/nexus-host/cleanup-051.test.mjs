// NEXUS 0.5.1 stage 2 — cleanup of NEXUS-owned windows/tabs, close_window (D5), Calculator ownership, Edge cleanup,
// task cancel on session end. Fake UI Automation with state (windows, tabs, dirty documents, save prompts).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createGui} from './gui.mjs';
import {createConsent} from './consent.mjs';
import {createApps} from './apps.mjs';
import {createBrowser, profilePids} from './browser.mjs';
import {createProcs} from './procs.mjs';
import {validateCapabilities} from './capabilities.mjs';

const ROOT = {x: 0, y: 0, w: 1920, h: 1080};
const tab = (rid, name, dirty = false) => ({rid, name, selected: false, dirty});

/** Desktop model: wins = [{hwnd, pid, process, name, tabs, dirty}] ; records every UIA call. */
function desktop(wins) {
  const calls = [];
  let prompt = null; // {hwnd, rid}
  const strip = w => ({hwnd: w.hwnd, pid: w.pid, process: w.process, name: w.name, tabs: w.tabs.map(({rid, name, selected}) => ({rid, name, selected}))});
  const uia = async a => {
    calls.push(a);
    const base = {mode: a.mode, root: ROOT};
    switch (a.mode) {
      case 'apps': return {...base, apps: wins.filter(w => w.process.toLowerCase() === String(a.name).toLowerCase()).map(strip)};
      case 'windows': {
        const ws = wins.filter(w => w.pid === a.pid);
        return {...base, target: {pid: a.pid, process: ws[0]?.process || 'Other'}, windows: ws.map(w => ({name: w.name, hwnd: w.hwnd, rect: {x: 0, y: 0, w: 800, h: 600}})), focused: {ok: true, pid: 1, process: 'explorer'}};
      }
      case 'close': {
        const w = wins.find(x => x.hwnd === a.hwnd);
        if (!w) return {...base, found: false, invoked: false};
        if (a.rid) {
          const t = w.tabs.find(x => x.rid === a.rid);
          if (!t) return {...base, found: false, invoked: false};
          if (t.dirty) prompt = {hwnd: w.hwnd, rid: t.rid}; else w.tabs = w.tabs.filter(x => x !== t);
          return {...base, found: true, invoked: true, method: 'tab_close_button'};
        }
        if (w.dirty || w.tabs.some(t => t.dirty)) prompt = {hwnd: w.hwnd, rid: null}; else wins.splice(wins.indexOf(w), 1);
        return {...base, found: true, invoked: true, method: 'WindowPattern.Close'};
      }
      case 'dialog': {
        if (!prompt || prompt.hwnd !== a.hwnd) return {...base, dialog: null};
        const out = {...base, dialog: {buttons: [{role: 'save'}, {role: 'discard'}, {role: 'cancel'}]}};
        if (a.choice) {
          const w = wins.find(x => x.hwnd === prompt.hwnd);
          if (a.choice !== 'cancel') {
            if (prompt.rid) w.tabs = w.tabs.filter(t => t.rid !== prompt.rid); else wins.splice(wins.indexOf(w), 1);
            if (a.choice === 'save') desktop.saved.push(prompt.rid || prompt.hwnd);
          }
          prompt = null; Object.assign(out, {choice: a.choice, invoked: true});
        }
        return out;
      }
      default: return {...base, focused: {ok: true, pid: 1, process: 'explorer'}};
    }
  };
  return {uia, calls, wins};
}
desktop.saved = [];

function mk(wins, capsRaw = {gui_input: true}) {
  desktop.saved = [];
  const d = desktop(wins);
  const consent = createConsent();
  const caps = validateCapabilities(capsRaw);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nx051-'));
  const gui = createGui({caps, home, workspace: path.join(home, 'ws'), platform: 'win32', runUia: d.uia, consent, sleep: async () => {}, robot: {cmd: async () => ({}), start: async () => {}, stop() {}}});
  return {d, consent, gui, caps};
}
const closes = d => d.calls.filter(c => c.mode === 'close');

test('cleanup: only NEXUS tabs/windows are closed; scratch prompt answered Save; owner tabs untouched', async () => {
  const wins = [
    {hwnd: 10, pid: 7, process: 'Notepad', name: 'notes.txt - Notepad', tabs: [tab('o1', 'notes.txt', true), tab('o2', 'wrangler.jsonc')]},
    {hwnd: 20, pid: 9, process: 'CalculatorApp', name: 'Calculator', tabs: []},
  ];
  const {d, consent, gui} = mk(wins);
  // NEXUS opened a scratch tab (token) in the owner's Notepad window, and a Calculator window.
  const before = [{...wins[0], tabs: wins[0].tabs.map(t => ({...t}))}];
  wins[0].tabs.push(tab('nx', 'NEXUS-abc123.txt', true));
  const c1 = consent.recordCreated(before, [{...wins[0]}], 'open_app:notepad', {token: 'NEXUS-abc123'});
  assert.deepEqual(c1.tabs, ['NEXUS-abc123.txt']);
  assert.equal(consent.recordCreated([], [wins[1]], 'open_app:calculator').windows.length, 1);
  assert.deepEqual([...consent.owned.apps].sort(), ['CalculatorApp', 'Notepad']);

  const r = await gui.cleanupOwned('finish_task');
  assert.deepEqual(r.closed.map(x => [x.app, x.kind, x.answered ?? null]).sort(), [['CalculatorApp', 'window', null], ['Notepad', 'tab', 'save']]);
  assert.deepEqual(r.left, []);
  assert.deepEqual(desktop.saved, ['nx'], 'scratch text saved into its NEXUS file, never discarded');
  assert.deepEqual(wins.map(w => [w.hwnd, w.tabs.map(t => t.rid)]), [[10, ['o1', 'o2']]], 'owner tabs remain, Calculator gone');
  assert.ok(closes(d).every(c => c.hwnd === 20 || c.rid === 'nx'), 'no close request ever targeted an owner tab');
  assert.equal(consent.owned.tabs.size + consent.owned.windows.size, 0);
  assert.deepEqual(await gui.cleanupOwned('again'), {closed: [], left: []}, 'idempotent');
});

test('cleanup: a NEXUS-opened non-scratch window with unsaved changes is left open (Cancel), owner decides', async () => {
  const wins = [{hwnd: 30, pid: 4, process: 'mspaint', name: 'Untitled - Paint', tabs: [], dirty: true}];
  const {consent, gui} = mk(wins, {gui_input: true, inputApps: ['Notepad', 'CalculatorApp', 'mspaint']});
  consent.recordCreated([], wins, 'open_app:paint');
  const r = await gui.cleanupOwned('lease_expired');
  assert.equal(r.closed.length, 0);
  assert.equal(r.left[0].why, 'unsaved_changes_owner_decides');
  assert.equal(wins.length, 1, 'window and its content kept');
  assert.equal(consent.owned.windows.size, 1, 'still owned (can be retried)');
});

test('cleanup: a window the owner already closed is pruned; a failed snapshot never drops ownership', async () => {
  const wins = [{hwnd: 40, pid: 9, process: 'CalculatorApp', name: 'Calculator', tabs: []}];
  const {consent, gui} = mk(wins);
  consent.recordCreated([], wins, 't');
  wins.length = 0;
  assert.deepEqual(await gui.cleanupOwned('x'), {closed: [], left: []});
  assert.equal(consent.owned.windows.size, 0);
  const c2 = createConsent(); c2.recordCreated([], [{hwnd: 41, pid: 9, process: 'CalculatorApp', name: 'C', tabs: []}], 't');
  const g2 = createGui({caps: validateCapabilities({gui_input: true}), home: os.tmpdir(), workspace: os.tmpdir(), platform: 'win32', consent: c2, sleep: async () => {},
    runUia: async a => { if (a.mode === 'apps') throw Error('uia_failed'); return {root: ROOT}; }});
  const r = await g2.cleanupOwned('x');
  assert.equal(r.left[0].why, 'snapshot_failed'); assert.equal(c2.owned.windows.size, 1);
});

test('D5 close_window: owner tab — consent without request; executes on direct owner request; grantsFromChat=false → consent', async () => {
  const wins = () => [{hwnd: 10, pid: 7, process: 'Notepad', name: 'Notepad', tabs: [tab('o1', 'todo.txt'), tab('o2', 'plan.txt')]}];
  let w = wins(); let {d, gui} = mk(w);
  const g = await gui.close_window({pid: 7, tab: 'todo'});
  assert.equal(g.status, 'consent_required'); assert.equal(closes(d).length, 0);
  const ok = await gui.close_window({pid: 7, tab: 'todo', ownerRequested: true});
  assert.equal(ok.closed, true); assert.equal(ok.by, 'owner_request');
  assert.deepEqual(w[0].tabs.map(t => t.rid), ['o2']);
  w = wins(); ({d, gui} = mk(w, {gui_input: true, grantsFromChat: false}));
  assert.equal((await gui.close_window({pid: 7, tab: 'todo', ownerRequested: true})).status, 'consent_required');
  assert.equal(closes(d).length, 0);
});

test('D5 close_window: unsaved owner text is never discarded without an explicit choice', async () => {
  const w = [{hwnd: 10, pid: 7, process: 'Notepad', name: 'Notepad', tabs: [tab('o1', 'draft.txt', true)]}];
  const {d, gui} = mk(w);
  const r = await gui.close_window({pid: 7, tab: 'draft', ownerRequested: true});
  assert.equal(r.status, 'unsaved_choice_required'); assert.deepEqual(r.options, ['save', 'discard', 'cancel']);
  assert.equal(r.closed, false); assert.equal(w[0].tabs.length, 1, 'text still there');
  assert.equal(d.calls.find(c => c.mode === 'dialog' && c.choice).choice, 'cancel');
  const r2 = await gui.close_window({pid: 7, tab: 'draft', ownerRequested: true, onUnsaved: 'discard'});
  assert.equal(r2.closed, true); assert.equal(r2.answered, 'discard');
  // discard without an owner request on a non-owned tab is impossible: gate first
  const w3 = [{hwnd: 11, pid: 8, process: 'Notepad', name: 'N', tabs: [tab('z', 'x.txt', true)]}];
  const m3 = mk(w3);
  assert.equal((await m3.gui.close_window({pid: 8, onUnsaved: 'discard'})).status, 'consent_required');
});

test('D5 close_window: ambiguous target → ask which one, nothing closed; confirm_action replay honours owner choice', async () => {
  const w = [{hwnd: 10, pid: 7, process: 'Notepad', name: 'a.txt - Notepad', tabs: []}, {hwnd: 11, pid: 7, process: 'Notepad', name: 'b.txt - Notepad', tabs: [], dirty: true}];
  const {d, consent, gui} = mk(w);
  const amb = await gui.close_window({pid: 7});
  assert.equal(amb.status, 'ambiguous'); assert.equal(amb.candidates.length, 2); assert.equal(closes(d).length, 0);
  const g = await gui.close_window({pid: 7, title: 'b.txt'});
  assert.equal(g.status, 'consent_required');
  const p = consent.take(g.consentId, 'close_save', g.target);
  const r = await gui.close_window(p.replay.args, {consented: p, decision: 'close_save'});
  assert.equal(r.closed, true); assert.equal(r.answered, 'save'); assert.equal(r.by, 'confirm_action');
  assert.deepEqual(w.map(x => x.hwnd), [10]);
});

test('Calculator: UWP frame reported under CalculatorApp is owned (fix for createdByNexus.windows=[])', async () => {
  const wins = [];
  const consent = createConsent();
  let n = 0;
  const gui = {snapshotApp: async () => { n++; return n > 3 ? [{hwnd: 777, pid: 55, process: 'CalculatorApp', name: 'Calculator', tabs: [], frameHost: true}] : []; }};
  const apps = createApps({caps: validateCapabilities({}), store: null, consent, gui, workspace: os.tmpdir(), platform: 'win32', wait: async () => {},
    execDeps: {platform: 'win32', systemRoot: 'C:\\Windows', launcher: () => { const e = new EventEmitter(); e.pid = 1; e.unref = () => {}; setImmediate(() => e.emit('spawn')); return e; }}});
  const r = await apps.open_app({app: 'calculator'});
  assert.deepEqual(r.createdByNexus.windows, ['Calculator']);
  assert.ok(consent.owned.windows.has('777')); assert.ok(consent.owned.apps.has('CalculatorApp'));
  void wins;
});

test('Edge cleanup: CDP close → tree kill if still alive → sweep of OUR profile only', async () => {
  const killed = [];
  let listed = 0;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nx051-br-'));
  const b = createBrowser({caps: validateCapabilities({browser: true}), home, platform: 'win32',
    listPids: () => (listed++ === 0 ? [901, 902] : []), kill: (pids, o) => { killed.push([pids, !!o?.tree]); return pids.length; }});
  const r = await b.cleanupSession('finish_task');
  assert.equal(r.wasOpen, false); assert.deepEqual(killed, [[[901, 902], false]]); assert.equal(r.remaining, 0);
  const r2 = await b.cleanupSession('again');
  assert.deepEqual([r2.swept, killed.length], [0, 1], 'nothing to do when our browser never ran again');
});

test('profilePids matches exactly our --user-data-dir (not a sibling dir, not the owner Edge)', () => {
  const prof = 'C:\\Users\\a\\.nexus-host\\edge-profile';
  const rows = [
    {pid: 1, cmd: `"msedge.exe" --user-data-dir=${prof} --remote-debugging-port=0`},
    {pid: 2, cmd: `"msedge.exe" --type=renderer --user-data-dir="${prof}" --x`},
    {pid: 3, cmd: `"msedge.exe" --user-data-dir=${prof}2`},
    {pid: 4, cmd: '"msedge.exe" --profile-directory=Default'},
    {pid: 5, cmd: `"msedge.exe" --user-data-dir=${prof}`},
  ];
  const run = () => ({status: 0, stdout: JSON.stringify(rows)});
  assert.deepEqual(profilePids(prof, {platform: 'win32', systemRoot: 'C:\\Windows', run}), [1, 2, 5]);
  assert.deepEqual(profilePids(prof, {platform: 'win32', systemRoot: 'C:\\Windows', run: () => ({status: 1, stdout: ''})}), []);
});

test('Edge cleanup on Linux finds real processes by profile (/proc) and kills them', {skip: process.platform !== 'linux' && 'linux /proc only'}, async () => {
  const {spawn} = await import('node:child_process');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nx051-proc-'));
  const prof = path.join(home, 'edge-profile');
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', '--', '--user-data-dir=' + prof], {stdio: 'ignore'});
  await new Promise(r => setTimeout(r, 200));
  assert.deepEqual(profilePids(prof, {platform: 'linux'}), [child.pid]);
  const b = createBrowser({caps: validateCapabilities({browser: true}), home, platform: 'linux'});
  const r = await b.cleanupSession('finish_task');
  assert.equal(r.swept, 1); assert.equal(r.remaining, 0);
  await new Promise(res => (child.exitCode !== null || child.signalCode ? res() : child.once('exit', res)));
});

test('procs.cancelSession cancels only tasks started during the session (real child process)', {skip: process.platform === 'win32' && 'uses /bin/sleep'}, async () => {
  const caps = validateCapabilities({run_task: true, tasks: {sl: {exe: '/bin/sleep', args: ['30'], timeoutSec: 60}}});
  const procs = createProcs({caps, cfg: {workspace: os.tmpdir(), auditFile: path.join(os.tmpdir(), 'nx.log')}, platform: 'linux'});
  const old = await procs.run_task({task: 'sl'});
  await new Promise(r => setTimeout(r, 1100));
  const sessStart = Date.now();
  const cur = await procs.run_task({task: 'sl'});
  const r = await procs.cancelSession('client_cancelled', {startedAt: sessStart});
  assert.deepEqual(r.cancelled.map(x => x.id), [cur.id]);
  assert.equal((await procs.task_status({id: cur.id})).state, 'cancelled');
  assert.equal((await procs.task_status({id: old.id})).state, 'running', 'task from before the session is not touched');
  procs.stopAll();
});

// 0.5.1 live acceptance defect: Win11 Notepad tab → tab_close_button_missing. Guarded Ctrl+W fallback.
function notepadNoButton({selectWorks = true, foreground = 10} = {}) {
  const wins = [{hwnd: 10, pid: 7, process: 'Notepad', name: 'notes.txt - Notepad', tabs: [tab('o1', 'notes.txt', true), tab('o2', 'todo.txt'), tab('nx', 'NEXUS-abc123.txt')]}];
  wins[0].tabs[0].selected = true;
  const keys = [];
  let fg = foreground;
  const d = desktop(wins);
  const uia = async a => {
    if (a.mode === 'close' && a.rid) {
      d.calls.push(a);
      const w = wins.find(x => x.hwnd === a.hwnd);
      if (selectWorks) for (const t of w.tabs) t.selected = t.rid === a.rid;
      return {mode: 'close', found: true, invoked: false, method: 'tab_close_button_missing', tabButtons: []};
    }
    if (a.mode === 'activate') { d.calls.push(a); return {mode: 'activate'}; }
    if (a.mode === 'focused') { d.calls.push(a); return {mode: 'focused', root: ROOT, focused: {ok: true, pid: fg === 10 ? 7 : 99, process: fg === 10 ? 'Notepad' : 'Other', topHwnd: fg}}; }
    return d.uia(a);
  };
  const robot = {cmd: async c => { keys.push(c); if (c === 'key ctrl+w' && fg === 10) { const w = wins[0]; const s = w.tabs.find(t => t.selected); w.tabs = w.tabs.filter(t => t !== s); } return {}; }, start: async () => {}, stop() {}};
  const consent = createConsent();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nx051k-'));
  const gui = createGui({caps: validateCapabilities({gui_input: true}), home, workspace: path.join(home, 'ws'), platform: 'win32', runUia: uia, consent, sleep: async () => {}, robot});
  const before = [{...wins[0], tabs: wins[0].tabs.filter(t => t.rid !== 'nx').map(t => ({...t}))}];
  consent.recordCreated(before, [wins[0]], 'open_app:notepad', {token: 'NEXUS-abc123'});
  return {wins, keys, gui, consent};
}

test('Win11 Notepad: no close button → Ctrl+W only after foreground+selected tab verified; owner window and tabs stay', async () => {
  const {wins, keys, gui, consent} = notepadNoButton();
  const r = await gui.cleanupOwned('finish_task');
  assert.deepEqual(keys, ['key ctrl+w']);
  assert.equal(r.closed.length, 1); assert.equal(r.closed[0].method, 'ctrl_w_verified'); assert.equal(r.closed[0].kind, 'tab');
  assert.deepEqual(wins.map(w => [w.hwnd, w.tabs.map(t => t.rid)]), [[10, ['o1', 'o2']]], 'window kept, only our tab gone');
  assert.equal(consent.owned.tabs.size, 0);
});

test('Win11 Notepad: if our tab is not the selected one, or another window is in front — no keystroke, reported', async () => {
  for (const o of [{selectWorks: false}, {foreground: 55}]) {
    const {wins, keys, gui} = notepadNoButton(o);
    const r = await gui.cleanupOwned('finish_task');
    assert.deepEqual(keys, [], JSON.stringify(o));
    assert.equal(r.closed.length, 0);
    assert.equal(r.left[0].fallback, 'focus_or_selection_not_verified');
    assert.equal(wins[0].tabs.length, 3, 'nothing closed');
  }
});
