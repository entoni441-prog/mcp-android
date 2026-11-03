// NEXUS NEXT block 1: sticky persisted STOP, no auto-resume of a stopped task, task heartbeat lease (view_idle), stale_args.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createSession} from './session.mjs';
import {loadConfig, createRuntime, handleRpc} from './server.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-next-b1-'));
const clock = (t = Date.parse('2026-11-03T10:00:00Z')) => ({now: () => t, add: ms => { t += ms; }});

function runtime(home) {
  const cfg = loadConfig({NEXUS_HOME: home, NEXUS_TOKEN: 'x'.repeat(40), NEXUS_WORKSPACE: path.join(home, 'ws'),
    NEXUS_CAPABILITIES_JSON: JSON.stringify({gui_input: true, screen_capture: true, ui_read: true, live_view: true})});
  fs.mkdirSync(cfg.workspace, {recursive: true});
  cfg.runtime = createRuntime(cfg, {guiDeps: {platform: 'win32', runUia: async () => ({})}, sessionDeps: {setIntervalFn: () => null}});
  const call = async (name, args = {}) => {
    const r = await handleRpc({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: args}}, cfg);
    return r.result.isError ? {error: r.result.content.map(c => c.text).join('\n')} : r.result.structuredContent;
  };
  return {cfg, call};
}

test('NEXT STOP: sticky, persisted across Host restart, stopped task does not resume until live_control resume; then stale_args', async () => {
  const home = fs.mkdtempSync(path.join(tmp, 'home-'));
  const a = runtime(home);
  await a.call('mouse_action', {action: 'nope'}); // starts the work session and the task (invalid args)
  const id = a.cfg.runtime.tasks.peek().id;
  const st = await a.call('live_control', {action: 'stop'});
  assert.equal(st.taskStopped, true);
  await new Promise(r => setImmediate(r));
  assert.equal(fs.existsSync(path.join(home, 'owner-stop.json')), true, 'STOP is persisted');
  assert.match((await a.call('mouse_action', {action: 'click', x: 1, y: 1})).error, /stopped_by_owner/);
  a.cfg.runtime.stop();

  const b = runtime(home); // Host restart
  assert.match((await b.call('mouse_action', {action: 'click', x: 1, y: 1})).error, /stopped_by_owner/, 'restart does not lift STOP');
  const caps = await b.call('get_capabilities');
  assert.equal(caps.state, 'owner_stop'); assert.equal(caps.task.task, id); assert.equal(caps.task.status, 'stopped_by_owner');
  const res = await b.call('live_control', {action: 'resume'});
  assert.deepEqual([res.stopCleared, res.taskResumeAllowed], [true, true]);
  assert.equal(fs.existsSync(path.join(home, 'owner-stop.json')), false);
  const stale = await b.call('mouse_action', {action: 'click', x: 1, y: 1});
  assert.match(stale.error, /^error: stale_args/); assert.match(stale.error, /resumePoint/);
  const c2 = await b.call('get_capabilities');
  assert.equal(c2.task.task, id, 'same task id after the owner go-ahead'); assert.equal(c2.task.resumes, 1);
  assert.match(c2.reobserveRequired.why, /^(owner_stop_resumed|task_resumed)$/);
  const fin = await b.call('finish_task');
  assert.equal(fin.taskStatus, 'finished');
  assert.equal((await b.call('get_capabilities')).reobserveRequired, undefined);
  b.cfg.runtime.stop();
});

test('NEXT STOP: finish_task without a session closes a stopped task (no desktop action)', async () => {
  const home = fs.mkdtempSync(path.join(tmp, 'home-'));
  const a = runtime(home);
  await a.call('mouse_action', {action: 'nope'});
  await a.call('live_control', {action: 'stop'}); await new Promise(r => setImmediate(r));
  const fin = await a.call('finish_task');
  assert.equal(fin.taskStatus, 'finished'); assert.equal(a.cfg.runtime.tasks.peek(), null);
  a.cfg.runtime.stop();
});

test('NEXT heartbeat: with an open task the lease is 10 min (view_idle); watch-only stays 45 s (lease_expired)', async () => {
  const c = clock();
  let task = true;
  const s = createSession({caps: {live_view: true}, now: c.now, setIntervalFn: () => null, clearIntervalFn: () => {}});
  s.setTaskActive(() => task);
  await s.around('mouse_action', async () => 'ok');
  c.add(46_000); await s.tick();
  assert.equal(s.active(), true, 'task heartbeat keeps the session past 45 s');
  assert.equal(s.liveActive(), true);
  assert.equal(s.status().leaseIdleSec, 600);
  c.add(9 * 60_000); await s.tick(); assert.equal(s.active(), true);
  await s.around('task_status', async () => 'read'); // read-only call renews during a session
  c.add(9 * 60_000); await s.tick(); assert.equal(s.active(), true);
  c.add(61_000); await s.tick();
  assert.equal(s.active(), false); assert.equal(s.state(), 'view_idle'); assert.equal(s.status().lastEnded.reason, 'view_idle');
  task = false;
  s.beginWatch(); c.add(46_000); await s.tick();
  assert.equal(s.state(), 'lease_expired');
  s.stop();
});

test('NEXT states: owner_paused and owner_stop are reported as such', async () => {
  const s = createSession({caps: {live_view: true}, setIntervalFn: () => null, clearIntervalFn: () => {}});
  assert.equal(s.state(), 'idle');
  s.pauseForOwner('mouse'); assert.equal(s.state(), 'owner_paused');
  s.resumeOwner(); await s.ownerStop(); assert.equal(s.state(), 'owner_stop');
  s.resumeAfterStop(); assert.equal(s.state(), 'idle');
  s.stop();
});
