// NEXUS 0.5.1 — work session (lease) vs persistent grants. No real GUI: fake capture, injected clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createSession, WORK_TOOLS} from './session.mjs';
import {createLive} from './live.mjs';
import {loadConfig, createServer} from './server.mjs';

const clock = () => { let t = 1_000_000; return {now: () => t, add: ms => { t += ms; }}; };
const noTimer = () => null;

function rig(caps = {live_view: true, gui_input: true}, opts = {}) {
  const c = clock(), events = [];
  const session = createSession({caps, audit: e => events.push(e), now: c.now, setIntervalFn: noTimer, idleMs: 45_000, maxMs: 600_000, ...opts});
  let captures = 0;
  const live = createLive({caps, session, store: {set: () => ({})}, now: c.now, indicator: () => {}, setIntervalFn: noTimer,
    capture: async () => { captures++; return {jpeg: Buffer.from([1]), meta: {cursorX: 1, cursorY: 2}}; }});
  session.onEnd(async () => { live.sessionEnded(); return {liveActive: false}; });
  return {c, session, live, events, captures: () => captures};
}

test('Live View is on BEFORE the first GUI action runs; read-only tools do not start a session', async () => {
  const r = rig();
  await r.session.around('get_capabilities', async () => {});
  await r.session.around('inspect_ui', async () => {});
  assert.equal(r.session.active(), false, 'no session without desktop work');
  assert.equal((await r.live.live_frame({})).structured?.state ?? (await r.live.live_frame({})).state, 'ready');
  let liveDuringFirstAction = null;
  await r.session.around('mouse_action', async () => { liveDuringFirstAction = r.session.liveActive(); });
  assert.equal(liveDuringFirstAction, true);
  assert.equal((await r.live.live_frame({})).structured.state, 'live');
});

test('lease: frames do NOT renew it; idle TTL ends the session, stream stops at the source; grant stays', async () => {
  const r = rig();
  await r.session.around('keyboard_action', async () => {});
  for (let i = 0; i < 40; i++) { r.c.add(1500); await r.live.live_frame({}); await r.session.tick(); } // 60 s of a viewer polling
  assert.equal(r.session.active(), false, 'viewer polling cannot keep the lease alive');
  const n = r.captures();
  const f = await r.live.live_frame({});
  assert.equal(f.state, 'ready'); assert.equal(r.captures(), n, 'no capture after lease end');
  assert.equal(r.session.status().lastEnded.reason, 'lease_expired');
  assert.ok(r.events.some(e => e.event === 'session_end' && e.reason === 'lease_expired'));
});

test('lease: worst case after the last tool call is idleMs (+1 tick); an in-flight call holds the lease', async () => {
  const r = rig();
  await r.session.around('mouse_action', async () => {});
  r.c.add(44_000); await r.session.tick(); assert.equal(r.session.active(), true);
  r.c.add(2_000); await r.session.tick(); assert.equal(r.session.active(), false);
  // long call: 2 minutes in flight → still active
  let release; const p = r.session.around('run_task', () => new Promise(res => { release = res; }));
  r.c.add(120_000); await r.session.tick(); assert.equal(r.session.active(), true);
  release(); await p; r.c.add(46_000); await r.session.tick(); assert.equal(r.session.active(), false);
});

test('reasoning pause of 30 s between steps does NOT end the task (why idle TTL is 45 s, not 10–15 s)', async () => {
  const r = rig();
  for (let i = 0; i < 5; i++) { await r.session.around('keyboard_action', async () => {}); r.c.add(30_000); await r.session.tick(); }
  assert.equal(r.session.active(), true);
});

test('end hooks run once; end is idempotent; failing hook is reported, others still run', async () => {
  const r = rig(); const calls = [];
  r.session.onEnd(async () => { calls.push('a'); throw Error('boom'); });
  r.session.onEnd(async reason => { calls.push('b:' + reason); return {windows: {closed: 1}}; });
  await r.session.around('open_app', async () => {});
  const out = await r.session.end('finish_task');
  assert.equal(out.ended, true); assert.deepEqual(out.windows, {closed: 1}); assert.deepEqual(out.hookErrors, ['boom']);
  assert.equal((await r.session.end('finish_task')).ended, false);
  assert.deepEqual(calls, ['a', 'b:finish_task']);
});

test('owner opt-out: no stream for this session even with the grant; next watch request clears it', async () => {
  const r = rig();
  await r.session.around('mouse_action', async () => {});
  r.session.optOutLive();
  assert.equal((await r.live.live_frame({})).state, 'ready');
  r.session.beginWatch();
  assert.equal(r.session.liveActive(), true);
});

test('no live_view grant: GUI session runs without any capture', async () => {
  const r = rig({live_view: false, gui_input: true});
  await r.session.around('mouse_action', async () => {});
  assert.equal(r.session.active(), true); assert.equal(r.session.liveActive(), false);
  assert.equal((await r.live.live_frame({})).state, 'off'); assert.equal(r.captures(), 0);
});

test('every WORK tool is a real tool of the catalog', async () => {
  const {TOOLS} = await import('./catalog.mjs');
  for (const t of WORK_TOOLS) assert.ok(TOOLS.some(x => x.name === t), t);
  assert.ok(TOOLS.some(x => x.name === 'finish_task'));
});

// ---- over HTTP, real Host server (fake capture) ----
async function httpHost(capsJson) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-051-'));
  fs.mkdirSync(path.join(tmp, 'h'), {recursive: true});
  fs.writeFileSync(path.join(tmp, 'h', 'capabilities.json'), JSON.stringify(capsJson)); // real file: grants are persistent
  const cfg = loadConfig({NEXUS_HOME: path.join(tmp, 'h'), NEXUS_WORKSPACE: path.join(tmp, 'ws'), NEXUS_PORT: '0'});
  let captures = 0;
  const server = createServer(cfg, {platform: 'linux', sessionDeps: {setIntervalFn: noTimer},
    liveDeps: {indicator: () => {}}, guiDeps: {}});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  let id = 0;
  const rpc = async body => { const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${cfg.token}`}, body: JSON.stringify(body)}); return r.status === 202 || r.status === 204 ? null : (await r.json()); };
  const call = async (name, args = {}) => (await rpc({jsonrpc: '2.0', id: ++id, method: 'tools/call', params: {name, arguments: args}})).result;
  return {cfg, server, rpc, call, stop() { server.close(); cfg.runtime?.stop(); }, captures: () => captures};
}

test('HTTP: persistentGrant=true vs activeSession=false after finish_task; two tasks in a row need no new grant', async () => {
  const h = await httpHost({live_view: true, gui_input: true});
  try {
    for (let task = 0; task < 2; task++) {
      await h.call('mouse_action', {action: 'move', x: 1, y: 1}); // fails later on Linux, but the session starts first
      let c = (await h.call('get_capabilities')).structuredContent;
      assert.equal(c.grants.gui_input, true); assert.equal(c.session.active, true); assert.equal(c.session.liveActive, true);
      const fin = (await h.call('finish_task')).structuredContent;
      assert.equal(fin.ended, true); assert.equal(fin.verified.liveActive, false); assert.equal(fin.verified.sessionActive, false);
      // 0.5.1 stage 2: every cleanup step ran and reported (tasks, windows, browser)
      assert.ok(fin.tasks && fin.windows && fin.browser, JSON.stringify(fin)); assert.equal(fin.hookErrors, undefined);
      c = (await h.call('get_capabilities')).structuredContent;
      assert.equal(c.grants.gui_input, true, 'persistent grant survives'); assert.equal(c.grants.live_view, true);
      assert.equal(c.session.active, false); assert.equal(c.session.liveActive, false);
    }
    assert.equal((await h.call('live_frame')).structuredContent.state, 'ready', 'no frames after the task');
  } finally { h.stop(); }
});

test('HTTP: notifications/cancelled (ChatGPT Stop) ends the session immediately and is audited', async () => {
  const h = await httpHost({live_view: true, gui_input: true});
  try {
    await h.call('keyboard_action', {keys: 'enter'});
    assert.equal((await h.call('get_capabilities')).structuredContent.session.active, true);
    assert.equal(await h.rpc({jsonrpc: '2.0', method: 'notifications/cancelled', params: {requestId: 7, reason: 'user stop'}}), null);
    const c = (await h.call('get_capabilities')).structuredContent;
    assert.equal(c.session.active, false); assert.equal(c.session.lastEnded.reason, 'client_cancelled');
    const log = fs.readFileSync(h.cfg.auditFile, 'utf8');
    assert.match(log, /"event":"client_cancelled"/); assert.match(log, /"reason":"client_cancelled"/);
  } finally { h.stop(); }
});

test('HTTP: owner switch grantsFromChat=false → raising from chat refused, lowering allowed', async () => {
  const h = await httpHost({live_view: true, gui_input: false, grantsFromChat: false});
  try {
    assert.match((await h.call('set_capability', {capability: 'gui_input', enabled: true})).content[0].text, /owner_profile_required/);
    const low = (await h.call('set_capability', {capability: 'live_view', enabled: false})).structuredContent;
    assert.equal(low.enabled, false); assert.equal(low.persistent, true);
  } finally { h.stop(); }
});

test('HTTP: revoking gui_input ends the running session', async () => {
  const h = await httpHost({live_view: true, gui_input: true});
  try {
    await h.call('mouse_action', {action: 'move', x: 1, y: 1});
    await h.call('set_capability', {capability: 'gui_input', enabled: false});
    const c = (await h.call('get_capabilities')).structuredContent;
    assert.equal(c.session.active, false); assert.equal(c.session.lastEnded.reason, 'grant_revoked');
  } finally { h.stop(); }
});
