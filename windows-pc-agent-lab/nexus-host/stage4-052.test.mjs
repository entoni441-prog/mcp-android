// NEXUS 0.5.2 stage 4 — A-02 (Notepad redaction), B-01 (dialog opener), N-07 (Stop timing), clipboard report.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGui, notepadMasks, testPng} from './gui.mjs';
import {createConsent} from './consent.mjs';
import {validateCapabilities} from './capabilities.mjs';
import {classifyBrowserRisk} from './browser.mjs';
import {createSession} from './session.mjs';
import {createLive} from './live.mjs';
import * as appsMod from './apps.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-s4-'));
const id = r => r;
const own = (tabs = [], wins = []) => ({tabs: new Set(tabs), windows: new Set(wins.map(String)), pids: new Set(), apps: new Set(), scratch: new Set()});
const W = (hwnd, tabs, sel = 0, rect = {x: 10, y: 20, w: 300, h: 200}) => ({hwnd, pid: 7, process: 'Notepad', name: 'n', rect,
  tabs: tabs.map((rid, i) => ({rid, name: rid, selected: i === sel}))});

// ── A-02 pure rule ───────────────────────────────────────────────────────────────────────────────────────────────
test('A-02 masks: restored owner tabs hidden; NEXUS scratch tab visible only when selected (capture) / alone (live)', () => {
  const o = own(['nx']);
  assert.deepEqual(notepadMasks([W(1, ['pass', 'doc', 'nx'], 2)], o, id, 'capture'), {masks: [], hidden: 0});
  assert.equal(notepadMasks([W(1, ['pass', 'doc', 'nx'], 0)], o, id, 'capture').hidden, 1, 'owner tab selected → hidden');
  assert.equal(notepadMasks([W(1, ['pass', 'nx'], 1)], o, id, 'live').hidden, 1, 'live: any foreign tab → hidden');
  assert.equal(notepadMasks([W(1, ['nx'], 0)], o, id, 'live').hidden, 0);
  assert.equal(notepadMasks([W(1, ['a', 'b'], -1)], o, id, 'capture').hidden, 1, 'no selection known → hidden');
  // classic Notepad (no tabs): only a NEXUS-owned window is shown
  assert.equal(notepadMasks([W(5, [])], own([], [5]), id, 'capture').hidden, 0);
  assert.equal(notepadMasks([W(6, [])], own([], [5]), id, 'capture').hidden, 1);
  // fail-closed: snapshot failed, or a window to hide has no rectangle / no mapping
  assert.equal(notepadMasks(null, o, id), null);
  assert.equal(notepadMasks([{...W(1, ['pass']), rect: null}], o, id), null);
  assert.equal(notepadMasks([W(1, ['pass'])], o, null), null);
  assert.deepEqual(notepadMasks([], o, null), {masks: [], hidden: 0}, 'no Notepad → nothing to hide, mapping not needed');
});

test('A-02: the stage-2 temporary flag is gone; cold start is a permanent Owner Handoff', () => {
  assert.equal('NOTEPAD_COLD_START_BLOCKED' in appsMod, false);
});

// ── A-02 wired into gui ──────────────────────────────────────────────────────────────────────────────────────────
const INFO = {x: 0, y: 0, w: 1280, h: 720, scaleX: 1, scaleY: 1, screens: 1};
const ROOT = {x: 0, y: 0, w: 1280, h: 720};
function fake({apps = [], appsFail = false, treeText = 'SECRET-PASSPHRASE'} = {}) {
  const robotCmds = [];
  const uia = async a => {
    const base = {root: ROOT};
    if (a.mode === 'apps') { if (appsFail) throw Error('uia_failed'); return {...base, apps}; }
    if (a.mode === 'tree') return {...base, target: {pid: a.pid, process: 'Notepad'}, nodes: 2, tree: [{type: 'Window', name: 'N', rect: ROOT, children: [{type: 'Document', name: treeText, rect: ROOT}]}]};
    if (a.mode === 'focused') return {...base, focused: {pid: 7, process: 'Notepad'}};
    throw Error('bad mode ' + a.mode);
  };
  const robot = {cmd: async c => { robotCmds.push(c); if (c === 'info') return INFO;
    if (c.startsWith('capture') || c.startsWith('frame')) { const file = Buffer.from(c.split(' ')[c.startsWith('frame') ? 3 : 2], 'base64').toString(); fs.writeFileSync(file, testPng(8));
      return {screenW: 1280, screenH: 720, imageW: 1280, imageH: 720, colours: 9, masked: 0, ms: 3, cursorX: -1}; }
    return {ok: true}; }, start: async () => {}, stop() {}};
  return {uia, robot, robotCmds};
}
const mk = (f, consent = createConsent()) => ({consent, g: createGui({caps: validateCapabilities({gui_input: true, ui_read: true, screen_capture: true}),
  home: tmp, workspace: tmp, platform: 'win32', runUia: f.uia, robot: f.robot, consent})});

test('A-02 capture_screen: owner Notepad window painted over BEFORE the image leaves the Host; snapshot failure → no image', async () => {
  const f = fake({apps: [W(1, ['pass', 'nx'], 0, {x: 100, y: 50, w: 400, h: 300})]});
  const {consent, g} = mk(f);
  consent.owned.tabs.add('nx');
  const r = await g.capture_screen({});
  const cap = f.robotCmds.find(c => c.startsWith('capture'));
  assert.equal(cap.split(' ')[3], '100,50,400,300');
  assert.equal(r.structured.hiddenWindows, 1);
  // NEXUS scratch selected → shown
  const f2 = fake({apps: [W(1, ['pass', 'nx'], 1)]}); const m2 = mk(f2); m2.consent.owned.tabs.add('nx');
  await m2.g.capture_screen({});
  assert.equal(f2.robotCmds.find(c => c.startsWith('capture')).split(' ')[3], '-');
  // fail-closed
  const f3 = fake({appsFail: true});
  await assert.rejects(mk(f3).g.capture_screen({}), /capture_redaction_unavailable/);
  assert.equal(f3.robotCmds.some(c => c.startsWith('capture')), false, 'no screen was captured at all');
});

test('A-02 Live View frame: any window holding an owner tab is hidden even if the NEXUS tab is selected', async () => {
  const f = fake({apps: [W(1, ['pass', 'nx'], 1, {x: 0, y: 0, w: 50, h: 60})]});
  const {consent, g} = mk(f); consent.owned.tabs.add('nx');
  await g.frameJpeg(960, 60);
  assert.equal(f.robotCmds.find(c => c.startsWith('frame')).split(' ')[4], '0,0,50,60');
});

test('NX-PR-01 private owner frame has no masks, standard frame and model capture stay masked',async()=>{
  const f=fake({apps:[W(1,['owner-document'],0,{x:20,y:30,w:170,h:120})]});
  const {g}=mk(f);
  await g.frameJpeg(960,60);
  assert.equal(f.robotCmds.at(-1).split(' ')[4],'20,30,170,120','ordinary Live always masked');
  await g.frameJpeg(960,60,null,{ownerOnly:true});
  assert.equal(f.robotCmds.at(-1).split(' ')[4],'-','private owner frame unmasked');
  await g.capture_screen({});
  assert.equal(f.robotCmds.at(-1).split(' ')[3],'20,30,170,120','model screenshot masked even after owner preview');
  await assert.rejects(g.frameJpeg(960,60,null,{ownerOnly:false}),/invalid_capture_scope/);
});

test('A-02 inspect_ui includeText: owner Notepad document text is never returned; NEXUS scratch text is', async () => {
  const f = fake({apps: [W(1, ['pass', 'nx'], 0)]});
  const {consent, g} = mk(f); consent.owned.tabs.add('nx');
  const r = await g.inspect_ui({pid: 7, includeText: true});
  assert.equal(r.textWithheld, 'notepad_owner_document');
  assert.doesNotMatch(JSON.stringify(r), /SECRET-PASSPHRASE/);
  const f2 = fake({apps: [W(1, ['pass', 'nx'], 1)], treeText: 'nexus scratch text'});
  const m2 = mk(f2); m2.consent.owned.tabs.add('nx');
  const r2 = await m2.g.inspect_ui({pid: 7, includeText: true});
  assert.equal(r2.textWithheld, undefined); assert.match(JSON.stringify(r2), /nexus scratch text/);
  const f3 = fake({appsFail: true});
  const r3 = await mk(f3).g.inspect_ui({pid: 7, includeText: true});
  assert.equal(r3.textWithheld, 'notepad_owner_document', 'snapshot failure → withheld');
});

// ── B-01 pure rule ───────────────────────────────────────────────────────────────────────────────────────────────
test('B-01: a control that only opens a dialog is autonomous; submit/commit controls are not', () => {
  assert.equal(classifyBrowserRisk({label: 'Place Order', opensDialog: 'modal'}), null);
  assert.equal(classifyBrowserRisk({label: 'Delete account', opensDialog: 'aria_dialog'}), null, 'the confirm inside the dialog is classified on its own');
  assert.equal(classifyBrowserRisk({label: 'Place Order', opensDialog: 'modal', submit: true}).what, 'browser_financial');
  assert.equal(classifyBrowserRisk({label: 'Place Order'}).what, 'browser_financial');
  assert.equal(classifyBrowserRisk({label: 'Purchase'}).what, 'browser_financial');
  assert.equal(classifyBrowserRisk({label: 'Continue', submit: true, checkout: 'url'}).what, 'browser_financial');
});

// ── N-07 Stop timing ─────────────────────────────────────────────────────────────────────────────────────────────
function rig() {
  let t = 1_000_000; const c = {now: () => t, add: ms => { t += ms; }};
  const caps = {live_view: true, gui_input: true};
  const session = createSession({caps, now: c.now, setIntervalFn: () => null, idleMs: 45_000});
  let release; const gate = new Promise(r => { release = r; });
  let slow = false;
  const live = createLive({caps, session, store: {set: () => ({})}, now: c.now, indicator: () => {}, setIntervalFn: () => null,
    capture: async () => { if (slow) await gate; return {jpeg: Buffer.from([1]), meta: {cursorX: 1, cursorY: 1}}; }});
  session.onEnd(async () => { const m = live.sessionEnded(); return {liveActive: false, liveLastFrameAt: m.lastFrameAt, liveFramesDropped: m.droppedAfterStop}; }, 'live');
  session.onEnd(async () => { c.add(120); return {windows: {closed: 1}}; }, 'windows');
  return {c, session, live, setSlow: v => { slow = v; }, release};
}

test('N-07: Stop report carries Host marks (receipt → live off → cleanup) and says the owner press is not visible', async () => {
  const r = rig();
  await r.session.around('mouse_action', async () => {});
  assert.equal((await r.live.live_frame({})).structured.state, 'live');
  r.c.add(1000);
  const recv = r.c.now(); r.c.add(15);
  const out = await r.session.end('client_cancelled', {receivedAt: recv});
  assert.equal(out.timing.trigger, 'client_cancelled');
  assert.equal(out.timing.liveOffMs, 15);
  assert.equal(out.timing.cleanupMs, 120); assert.equal(out.timing.hooksMs.windows, 120);
  assert.equal(out.timing.hostTotalMs, 135);
  assert.equal(out.timing.framesAfterStop, 0);
  assert.ok(out.timing.lastFrameAt);
  assert.match(out.timing.ownerPress, /not visible/);
  assert.equal(r.session.status().lastEnded.timing.hostTotalMs, 135);
});

test('N-07: a frame captured while Stop arrives is dropped, never delivered', async () => {
  const r = rig();
  await r.session.around('mouse_action', async () => {});
  r.setSlow(true);
  const p = r.live.live_frame({});
  await new Promise(x => setImmediate(x));
  const out = await r.session.end('client_cancelled');
  r.release();
  const f = await p;
  assert.equal(f.content, undefined, 'no image content');
  assert.equal(f.state, 'ready');
  assert.equal(out.timing.framesAfterStop, 0);
});

test('N-07: idle lease end reports detection lag', async () => {
  const r = rig();
  await r.session.around('mouse_action', async () => {});
  r.c.add(46_500);
  const out = await r.session.end('lease_expired');
  assert.equal(out.timing.idleDetectLagMs, 1500);
});
