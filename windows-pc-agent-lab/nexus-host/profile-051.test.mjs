// 0.5.1 D1/D4 — owner profile CLI: persistent grants without hand-editing JSON; grant ≠ active session.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runProfile, commandToMutation} from './nexus-profile.mjs';
import {DEFAULT_CAPABILITIES} from './capabilities.mjs';
import {createCapStore} from './capstore.mjs';
import {validateCapabilities} from './capabilities.mjs';
import {createSession} from './session.mjs';

// a 0.5.x-style restricted profile (since 0.6.1 these switches are on unless the owner turns them off)
const OFF = {gui_input: false, process_control: false, run_task: false, browser: false, live_view: false};
const fresh = () => { const h = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-prof-'));
  fs.writeFileSync(path.join(h, 'capabilities.json'), JSON.stringify({_comment: 'x', ...DEFAULT_CAPABILITIES, ...OFF, tasks: {t1: {exe: '/usr/bin/true'}}}, null, 2)); return h; };
const quiet = {out: () => {}};

test('autonomous preset sets the profile once; unrelated keys and comments survive; minimal reverts', () => {
  const home = fresh();
  const r = runProfile(['autonomous'], {home, ...quiet});
  for (const k of ['gui_input', 'browser', 'live_view', 'screen_capture', 'ui_read']) assert.equal(r.caps[k], true, k);
  assert.equal(r.caps.process_control, false); assert.equal(r.caps.run_task, false);
  const raw = JSON.parse(fs.readFileSync(path.join(home, 'capabilities.json'), 'utf8'));
  assert.equal(raw._comment, 'x'); assert.ok(raw.tasks.t1);
  assert.deepEqual(Object.keys(runProfile(['autonomous'], {home, ...quiet}).changes), []); // idempotent
  const m = runProfile(['minimal'], {home, ...quiet}).caps;
  assert.equal(m.gui_input, false); assert.equal(m.browser, false); assert.equal(m.live_view, false);
});

test('apps: allow/deny; HARD_DENY and script paths refused; chat-grants switch', () => {
  const home = fresh();
  assert.ok(runProfile(['allow-app', 'mspaint.exe'], {home, ...quiet}).caps.inputApps.includes('mspaint'));
  assert.ok(!runProfile(['deny-app', 'mspaint'], {home, ...quiet}).caps.inputApps.includes('mspaint'));
  for (const bad of [['allow-app', 'powershell'], ['allow-app', 'SystemSettings'], ['allow-app', 'x', '/tmp/run.cmd'], ['on', 'everything'], ['frobnicate']])
    assert.throws(() => commandToMutation(bad), undefined, bad.join(' '));
  assert.equal(runProfile(['chat-grants', 'off'], {home, ...quiet}).caps.grantsFromChat, false);
});

test('a running Host picks the profile up without restart (live store refresh)', async () => {
  const home = fresh(); const file = path.join(home, 'capabilities.json');
  const store = createCapStore({file, initial: validateCapabilities(JSON.parse(fs.readFileSync(file, 'utf8')))});
  assert.equal(store.view.gui_input, false);
  await new Promise(r => setTimeout(r, 20));
  runProfile(['autonomous'], {home, ...quiet});
  store.refresh();
  assert.equal(store.view.gui_input, true); assert.equal(store.view.browser, true);
});

test('D4: profile set once → two GUI tasks in a row need no new grant; after each persistentGrant=true, activeSession=false', async () => {
  const home = fresh(); const file = path.join(home, 'capabilities.json');
  runProfile(['autonomous'], {home, ...quiet});
  const store = createCapStore({file, initial: validateCapabilities(JSON.parse(fs.readFileSync(file, 'utf8')))});
  const ended = [];
  const s = createSession({caps: store.view, setIntervalFn: () => null, clearIntervalFn: () => {}});
  s.onEnd(async reason => { ended.push(reason); return {}; });
  for (const task of [1, 2]) {
    let liveDuringInput = null;
    await s.around('mouse_action', async () => { liveDuringInput = s.liveActive(); });
    assert.equal(liveDuringInput, true, `task ${task}: Live View on before the input ran`);
    await s.end('finish_task');
    const st = s.status();
    assert.equal(st.active, false); assert.equal(st.liveActive, false);
    assert.equal(store.view.gui_input && store.view.live_view && store.view.browser, true, 'persistent grant kept');
  }
  assert.deepEqual(ended, ['finish_task', 'finish_task']);
  s.stop();
});
