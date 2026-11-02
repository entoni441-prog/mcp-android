// REAL Windows (CI runner): NEXUS 0.5.1 stage 2 — session-end cleanup. win32 + NEXUS_REAL_GUI=1 only.
//  1) open_app notepad → type into the scratch → cleanupOwned: scratch closed WITHOUT a hanging prompt, text saved
//     into the NEXUS scratch file; an owner Notepad (started outside NEXUS, with unsaved text) stays open and intact.
//  2) close_window on the owner window: consent without request; ownerRequested → unsaved_choice_required, text kept.
//  3) Calculator (if the runner has it): createdByNexus.windows is not empty; cleanup closes it.
//  4) Edge: NEXUS browser started, cleanupSession → no process with our profile remains; a second Edge with another
//     profile (stands in for the owner's Edge) survives.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {createGui} from './gui.mjs';
import {createConsent} from './consent.mjs';
import {createApps} from './apps.mjs';
import {createBrowser, profilePids, findEdge} from './browser.mjs';
import {listWindows} from './windows.mjs';
import {validateCapabilities} from './capabilities.mjs';

const RUN = process.platform === 'win32' && process.env.NEXUS_REAL_GUI === '1';
const SKIP = !RUN && 'win32 + NEXUS_REAL_GUI=1 only';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const taskkill = pid => spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(pid), '/t', '/f']);

test('Windows 0.5.1: scratch closes with Save (no hanging prompt); owner Notepad untouched; D5 unsaved choice', {skip: SKIP, timeout: 300_000}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-cleanup-real-'));
  const ws = path.join(home, 'ws');
  const log = [];
  const consent = createConsent({audit: e => log.push(e)});
  const caps = validateCapabilities({gui_input: true});
  const gui = createGui({caps, home, workspace: ws, platform: 'win32', consent});
  const apps = createApps({caps, store: null, consent, gui, workspace: ws, platform: 'win32'});
  const pids = [];
  try {
    // owner Notepad with unsaved text
    const known = new Set((await listWindows({}, {tmpDir: home})).windows.map(w => w.pid));
    spawn(path.join(process.env.SystemRoot, 'System32', 'notepad.exe'), [], {detached: true, stdio: 'ignore'}).unref();
    let owner = null;
    for (let i = 0; i < 30 && !owner; i++) { await sleep(500); owner = (await listWindows({}, {tmpDir: home})).windows.find(w => /^notepad$/i.test(w.process) && !known.has(w.pid))?.pid; }
    assert.ok(owner, 'owner notepad'); pids.push(owner);
    const fo = await gui.focus_window({pid: owner});
    console.log('focus owner', JSON.stringify(fo));
    assert.equal(fo.focused, true);
    await gui.keyboard_action({text: 'owner unsaved text'});

    // NEXUS scratch
    const r = await apps.open_app({app: 'notepad'});
    console.log('open_app', JSON.stringify(r));
    const token = r.scratchFile.match(/NEXUS-[0-9a-f]{6}/)[0];
    const mine = (await listWindows({includeTitles: true}, {tmpDir: home})).windows.find(w => /^notepad$/i.test(w.process) && (w.title || '').includes(token));
    assert.ok(mine); pids.push(mine.pid);
    const fm = await gui.focus_window({pid: mine.pid});
    console.log('focus scratch', JSON.stringify(fm));
    assert.equal(fm.focused, true);
    await gui.keyboard_action({text: 'scratch text 051'});

    const t0 = Date.now();
    const c = await gui.cleanupOwned('finish_task');
    console.log('cleanup', Date.now() - t0, 'ms', JSON.stringify(c));
    assert.equal(c.closed.length, 1, 'scratch closed'); assert.deepEqual(c.left, []);
    const after = (await listWindows({includeTitles: true}, {tmpDir: home})).windows;
    assert.ok(!after.some(w => (w.title || '').includes(token)), 'no scratch window and no hanging prompt');
    assert.ok(after.some(w => w.pid === owner), 'owner Notepad still open');
    assert.match(fs.readFileSync(path.join(ws, '.nexus-scratch', token + '.txt'), 'utf8'), /scratch text 051/, 'scratch text saved, not discarded');

    // D5 on the owner window
    const g = await gui.close_window({pid: owner});
    console.log('close owner (no request)', JSON.stringify(g));
    assert.equal(g.status, 'consent_required');
    const q = await gui.close_window({pid: owner, ownerRequested: true});
    console.log('close owner (requested, unsaved)', JSON.stringify(q));
    assert.equal(q.status, 'unsaved_choice_required');
    await sleep(500);
    assert.ok((await listWindows({}, {tmpDir: home})).windows.some(w => w.pid === owner), 'owner text kept, window open');
    const d = await gui.close_window({pid: owner, ownerRequested: true, onUnsaved: 'discard'});
    console.log('close owner (requested, discard)', JSON.stringify(d));
    assert.equal(d.closed, true);
    console.log('audit', JSON.stringify(log.map(e => e.event)));
  } finally { for (const p of pids) taskkill(p); gui.stop(); }
});

test('Windows 0.5.1: Calculator window is owned and cleaned up (skipped if the runner has no Calculator)', {skip: SKIP, timeout: 120_000}, async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-calc-real-'));
  const consent = createConsent();
  const caps = validateCapabilities({gui_input: true});
  const gui = createGui({caps, home, workspace: home, platform: 'win32', consent});
  const apps = createApps({caps, store: null, consent, gui, workspace: home, platform: 'win32'});
  try {
    let r;
    try { r = await apps.open_app({app: 'calculator'}); } catch (e) { t.skip('calculator not launchable: ' + e.message); return; }
    console.log('open calculator', JSON.stringify(r));
    await sleep(3000);
    const snap = await gui.snapshotApp('CalculatorApp');
    console.log('CalculatorApp windows', JSON.stringify(snap));
    if (!snap?.length) { t.skip('no Calculator window on this runner'); return; }
    assert.ok(r.createdByNexus.windows.length === 1 || consent.owned.windows.size === 1, 'Calculator window owned');
    const c = await gui.cleanupOwned('finish_task');
    console.log('cleanup', JSON.stringify(c));
    assert.equal(c.closed.length, 1);
  } finally { gui.stop(); }
});

test('Windows 0.5.1: NEXUS Edge fully stopped at session end; another Edge profile survives', {skip: SKIP, timeout: 180_000}, async t => {
  const caps = validateCapabilities({browser: true});
  const edge = findEdge(caps);
  if (!edge) { t.skip('Edge not installed'); return; }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-edge-real-'));
  const otherProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-edge-'));
  const other = spawn(edge, [`--user-data-dir=${otherProfile}`, '--no-first-run', '--headless=new', '--no-sandbox', 'about:blank'], {stdio: 'ignore'});
  const b = createBrowser({caps, home, platform: 'win32', headless: true});
  try {
    await b.browser_tabs({action: 'new'});
    const prof = path.join(home, 'edge-profile');
    const before = profilePids(prof);
    console.log('nexus edge pids', before.length);
    assert.ok(before.length >= 1, 'NEXUS Edge processes found by profile');
    await sleep(1000);
    const otherBefore = profilePids(otherProfile);
    assert.ok(otherBefore.length >= 1, 'second Edge running');
    const r = await b.cleanupSession('finish_task');
    console.log('cleanup', JSON.stringify(r));
    await sleep(1000);
    assert.deepEqual(profilePids(prof), [], 'no process with the NEXUS profile left');
    assert.equal(other.exitCode, null, 'other Edge main process not killed');
    const otherAfter = new Set(profilePids(otherProfile));
    assert.ok(otherAfter.has(other.pid) || otherBefore.every(p => otherAfter.has(p)), 'other Edge untouched');
  } finally { b.stop(); taskkill(other.pid); }
});
