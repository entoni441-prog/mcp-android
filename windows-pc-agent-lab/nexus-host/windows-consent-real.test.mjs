// REAL Windows (CI runner, classic Notepad): 0.4.2 owner consent for closing. win32 + NEXUS_REAL_GUI=1 only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {createGui, runUiaReal} from './gui.mjs';
import {createConsent} from './consent.mjs';
import {listWindows} from './windows.mjs';
import {validateCapabilities} from './capabilities.mjs';

const RUN = process.platform === 'win32' && process.env.NEXUS_REAL_GUI === '1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOTEPAD = () => path.join(process.env.SystemRoot, 'System32', 'notepad.exe');

async function newNotepad(home, known) {
  spawn(NOTEPAD(), [], {detached: true, stdio: 'ignore'}).unref();
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const w = (await listWindows({}, {tmpDir: home})).windows.find(x => /^notepad$/i.test(x.process) && !known.has(x.pid));
    if (w) { known.add(w.pid); return w.pid; }
  }
  throw Error('notepad not found');
}
const alive = async (home, pid) => (await listWindows({}, {tmpDir: home})).windows.some(w => w.pid === pid);
const flat = tree => { const out = []; const walk = n => { out.push(n); (n.children || []).forEach(walk); }; tree.forEach(walk); return out; };
async function waitGone(home, pid) { for (let i = 0; i < 20; i++) { if (!(await alive(home, pid))) return true; await sleep(300); } return false; }

test('Windows: closing a window NEXUS did not open needs consent; own window closes autonomously; «Don\'t Save» gated', {skip: !RUN && 'win32 + NEXUS_REAL_GUI=1 only', timeout: 300_000}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-consent-real-'));
  const log = [];
  const consent = createConsent({audit: e => log.push(e)});
  const gui = createGui({caps: validateCapabilities({gui_input: true}), home, workspace: path.join(home, 'ws'), platform: 'win32', consent});
  const known = new Set((await listWindows({}, {tmpDir: home})).windows.map(w => w.pid));
  const pids = [];
  try {
    // 1) FOREIGN Notepad (started outside NEXUS, like the owner's own window).
    const foreign = await newNotepad(home, known); pids.push(foreign);
    assert.equal((await gui.focus_window({pid: foreign})).focused, true);
    const k = await gui.keyboard_action({keys: 'alt+f4'});
    console.log('foreign alt+f4', JSON.stringify(k));
    assert.equal(k.status, 'consent_required');
    await sleep(800);
    assert.equal(await alive(home, foreign), true, 'foreign window must still be open');

    const tree = flat((await gui.inspect_ui({pid: foreign, maxDepth: 4, maxNodes: 300})).tree);
    const closeBtn = tree.find(n => n.type === 'Button' && /^(close|закрыть)$/i.test(n.name) && n.rect);
    console.log('close button', JSON.stringify(closeBtn));
    if (closeBtn) {
      const m = await gui.mouse_action({action: 'click', x: closeBtn.rect.x + Math.floor(closeBtn.rect.w / 2), y: closeBtn.rect.y + Math.floor(closeBtn.rect.h / 2)});
      console.log('foreign click Close', JSON.stringify(m));
      assert.equal(m.status, 'consent_required');
      await sleep(800);
      assert.equal(await alive(home, foreign), true);
    }
    // owner agrees → exact replay closes it (empty document: no save prompt)
    const p = consent.take(k.consentId, 'close_discard', k.target);
    await gui.focus_window({pid: foreign});
    const done = await gui.keyboard_action(p.replay.args, {consented: p, decision: 'close_discard'});
    console.log('foreign confirmed', JSON.stringify(done));
    assert.equal(await waitGone(home, foreign), true, 'consented close must close the window');

    // 2) OWN Notepad (recorded as NEXUS-created), with typed text → autonomous close, «Don't Save» allowed.
    const before = await gui.snapshotApp('notepad');
    const own = await newNotepad(home, known); pids.push(own);
    await sleep(500);
    const created = consent.recordCreated(before, await gui.snapshotApp('notepad'), 'test');
    console.log('created', JSON.stringify(created), 'owned', JSON.stringify([...consent.owned.windows]));
    console.log('snapshot', JSON.stringify((await gui.snapshotApp('notepad')).map(w => ({hwnd: w.hwnd, pid: w.pid, name: w.name}))));
    assert.equal(created.windows.length, 1);
    await gui.focus_window({pid: own});
    await gui.keyboard_action({text: 'NEXUS test text'});
    const ctx = await runUiaReal({mode: 'context'}, {tmpDir: path.join(home, 'tmp')});
    console.log('context', JSON.stringify({focused: ctx.focused, elem: ctx.elem, window: ctx.window && {hwnd: ctx.window.hwnd, pid: ctx.window.pid, name: ctx.window.name}}));
    const c = await gui.keyboard_action({keys: 'alt+f4'});
    console.log('own alt+f4', JSON.stringify(c));
    assert.equal(c.done, true); assert.equal(c.consented, false);
    await sleep(1200);
    const dlg = flat((await gui.inspect_ui({pid: own, maxDepth: 8, maxNodes: 400})).tree);
    console.log('dialog nodes', JSON.stringify(dlg.slice(0, 80).map(n => `${n.type}:${n.name}`)));
    console.log('own alive', await alive(home, own), JSON.stringify((await listWindows({includeTitles: true}, {tmpDir: home})).windows.filter(w => w.pid === own)));
    const dontSave = dlg.find(n => ['Button', 'Pane'].includes(n.type) && /^(don.?t save|не сохранять)$/i.test(n.name) && n.rect);
    console.log('dont save', JSON.stringify(dontSave));
    assert.ok(dontSave, 'save prompt expected');
    const ds = await gui.mouse_action({action: 'click', x: dontSave.rect.x + Math.floor(dontSave.rect.w / 2), y: dontSave.rect.y + Math.floor(dontSave.rect.h / 2)});
    console.log('own dont save', JSON.stringify(ds));
    assert.equal(ds.done, true);
    assert.equal(await waitGone(home, own), true);

    // 3) FOREIGN Notepad with text: «Don't Save» without an armed close → consent.
    const f2 = await newNotepad(home, known); pids.push(f2);
    await gui.focus_window({pid: f2});
    await gui.keyboard_action({text: 'owner text'});
    const k2 = await gui.keyboard_action({keys: 'alt+f4'});
    assert.equal(k2.status, 'consent_required');
    const p2 = consent.take(k2.consentId, 'close_save', k2.target);            // owner wants to KEEP the text
    await gui.keyboard_action(p2.replay.args, {consented: p2, decision: 'close_save'});
    await sleep(1200);
    const dlg2 = flat((await gui.inspect_ui({pid: f2, maxDepth: 8, maxNodes: 400})).tree);
    const ds2 = dlg2.find(n => ['Button', 'Pane'].includes(n.type) && /^(don.?t save|не сохранять)$/i.test(n.name) && n.rect);
    const r2 = await gui.mouse_action({action: 'click', x: ds2.rect.x + Math.floor(ds2.rect.w / 2), y: ds2.rect.y + Math.floor(ds2.rect.h / 2)});
    console.log('foreign dont save after close_save', JSON.stringify(r2));
    assert.equal(r2.status, 'consent_required', 'discard must not be possible when the owner chose save');
    assert.equal(await alive(home, f2), true);
    console.log('audit events', JSON.stringify(log.map(e => e.event)));
  } finally {
    for (const p of pids) spawnSync(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/pid', String(p), '/f']);
    gui.stop();
  }
});

// 0.5.0: open_app notepad opens a NEW scratch document; ownership is bound to its unique token, so a pre-existing
// owner Notepad window is never owned, and the scratch window closes autonomously.
test('Windows 0.5.0: open_app scratch document is owned by token; owner window is not', {skip: !RUN && 'win32 + NEXUS_REAL_GUI=1 only', timeout: 300_000}, async () => {
  const {createApps} = await import('./apps.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-scratch-real-'));
  const consent = createConsent();
  const caps = validateCapabilities({gui_input: true});
  const gui = createGui({caps, home, workspace: path.join(home, 'ws'), platform: 'win32', consent});
  const apps = createApps({caps, store: null, consent, gui, workspace: path.join(home, 'ws'), platform: 'win32'});
  const known = new Set((await listWindows({}, {tmpDir: home})).windows.map(w => w.pid));
  const owner = await newNotepad(home, known);
  const pids = [owner];
  try {
    const r = await apps.open_app({app: 'notepad'});
    console.log('open_app scratch', JSON.stringify(r));
    const token = r.scratchFile.match(/NEXUS-[0-9a-f]{6}/)[0];
    const owned = [...r.createdByNexus.windows, ...r.createdByNexus.tabs];
    assert.ok(owned.length >= 1 && owned.every(n => n.includes(token)), 'only names with the token are owned');
    const mine = (await listWindows({includeTitles: true}, {tmpDir: home})).windows.find(w => /^notepad$/i.test(w.process) && (w.title || '').includes(token));
    assert.ok(mine, 'scratch window visible'); pids.push(mine.pid);
    // owner window: close needs consent
    await gui.focus_window({pid: owner});
    assert.equal((await gui.keyboard_action({keys: 'alt+f4'})).status, 'consent_required');
    // scratch window: autonomous
    await gui.focus_window({pid: mine.pid});
    const k = await gui.keyboard_action({keys: 'ctrl+w'});
    console.log('scratch ctrl+w', JSON.stringify(k));
    assert.notEqual(k.status, 'consent_required');
  } finally {
    for (const p of pids) spawnSync(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(p), '/F']);
    gui.stop(); // the Java Robot child would otherwise keep the test process alive
  }
});
