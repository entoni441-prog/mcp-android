// 0.5.2 stage 3 — N-03 Owner Handoff + N-08 Task Continuity / idempotency. Fake GUI (UIA), real files, real runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createTaskLog, createHandoffs, evaluateVerify, isExternal, idemKey} from './handoff.mjs';
import {createSession} from './session.mjs';
import {createConsent} from './consent.mjs';
import {handoffSpec} from './policy.mjs';
import {loadConfig, createRuntime, handleRpc} from './server.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-052s3-'));
const dirOf = () => fs.mkdtempSync(path.join(tmp, 'tasks-'));
const clock = (t0 = Date.parse('2026-11-02T12:00:00Z')) => { let t = t0; return {now: () => t, add: ms => { t += ms; }}; };
const fakeSession = () => { const held = new Map(); return {held, hold: (k, ms, o) => { held.set(k, o); return true; }, release: k => held.delete(k)}; };

test('evaluateVerify: window present/absent, unknown snapshot fails closed, none = unverifiable', () => {
  assert.equal(evaluateVerify({kind: 'app_window'}, [{hwnd: 1}]), 'done');
  assert.equal(evaluateVerify({kind: 'app_window'}, []), 'waiting');
  assert.equal(evaluateVerify({kind: 'app_window'}, null), 'unknown');
  assert.equal(evaluateVerify({kind: 'no_window'}, []), 'done');
  assert.equal(evaluateVerify({kind: 'no_window'}, null), 'unknown', 'a failed snapshot never counts as «window gone»');
  assert.equal(evaluateVerify({kind: 'none'}, []), 'unverifiable');
});

test('handoffSpec: UAC is unverifiable by UIA (secure desktop), credential prompt verified by window, system processes stay refused', () => {
  assert.equal(handoffSpec('consent', 'hard_deny').verify.kind, 'none');
  assert.deepEqual(handoffSpec('CredentialUIBroker', 'hard_deny').verify, {kind: 'no_window', process: 'CredentialUIBroker'});
  assert.equal(handoffSpec('cmd', 'hard_deny').reason, 'shell_command');
  assert.equal(handoffSpec('mmc', 'mmc_snapin_not_allowed', 'Services').reason, 'mmc_snapin');
  for (const p of ['svchost', 'lsass', 'node', 'cloudflared', 'searchhost', '']) assert.equal(handoffSpec(p, 'hard_deny'), null, p);
  assert.doesNotMatch(JSON.stringify(handoffSpec('CredentialUIBroker', 'x')), /пароль.*сообщите|send.*password/i);
});

test('N-03: request pauses input+capture, holds the session, verifies by state, resumes with the stored step (not executed)', async () => {
  let wins = [];
  const s = fakeSession(), tasks = createTaskLog({dir: dirOf()});
  const h = createHandoffs({tasks, session: s, probe: {apps: async () => wins}, pollMs: 40, stepMs: 10});
  const r = h.request({reason: 'notepad_cold_start_session_restore', what: 'open Notepad', verify: {kind: 'app_window', process: 'notepad'},
    pause: {input: true, capture: true}, resume: {tool: 'open_app', args: {app: 'notepad'}}});
  assert.equal(r.status, 'owner_action_required'); assert.match(r.handoffId, /^h-[a-f0-9]{10}$/);
  assert.equal(r.state, 'waiting_owner'); assert.match(r.next, /task_status/); assert.match(r.next, /never ask for passwords/);
  assert.deepEqual([...s.held.values()], [{pauseLive: true}]);
  assert.throws(() => h.guard('mouse_action'), /owner_handoff_active/);
  assert.throws(() => h.guard('capture_screen'), /owner_handoff_active/);
  h.guard('task_status'); h.guard('list_windows'); h.guard('get_status'); // status/read-only tools stay available
  const w = await h.check(r.handoffId);
  assert.equal(w.state, 'waiting_owner'); assert.deepEqual(w.lastObserved, {windows: 0});
  assert.equal(tasks.peek().status, 'waiting_owner');
  wins = [{hwnd: 7, tabs: []}];
  const d = await h.check(r.handoffId);
  assert.equal(d.state, 'done'); assert.deepEqual(d.verified, {by: 'app_window', process: 'notepad', windows: 1});
  assert.match(d.next, /open_app \{"app":"notepad"\}.*NOT executed/);
  assert.equal(s.held.size, 0, 'session hold released'); h.guard('mouse_action');
  assert.equal(tasks.peek().status, 'active');
  assert.equal((await h.check(r.handoffId)).state, 'done', 'checking again is stable (gateway may retry read-only task_status)');
  assert.deepEqual(tasks.summary().handoffs, [{id: r.handoffId, state: 'done'}]);
});

test('N-03: owner refuses → declined, dependent step skipped, pause lifted; unknown id rejected', async () => {
  const s = fakeSession(), h = createHandoffs({tasks: createTaskLog({dir: dirOf()}), session: s, probe: {apps: async () => []}, pollMs: 20, stepMs: 10});
  const r = h.request({reason: 'x', what: 'y', verify: {kind: 'app_window', process: 'notepad'}});
  const d = h.decline(r.handoffId);
  assert.equal(d.state, 'declined'); assert.match(d.next, /Skip the dependent step/);
  h.guard('keyboard_action'); assert.equal(s.held.size, 0);
  assert.throws(() => h.decline('h-0000000000'), /unknown_handoff_id/);
  await assert.rejects(h.check('h-0000000000'), /unknown_handoff_id/);
});

test('N-03: expiry after TTL lifts the pause; unverifiable handoff tells ChatGPT to check consequences, not chat words', async () => {
  const c = clock();
  const h = createHandoffs({tasks: createTaskLog({dir: dirOf(), now: c.now}), now: c.now, probe: {apps: async () => []}, ttlMs: 1000, pollMs: 0, stepMs: 1});
  const r = h.request({reason: 'x', what: 'y', verify: {kind: 'app_window', process: 'a'}});
  c.add(1500);
  h.guard('mouse_action'); // expired → no longer paused
  assert.equal((await h.check(r.handoffId)).state, 'expired');
  const u = h.request({...handoffSpec('consent', 'hard_deny')});
  const v = await h.check(u.handoffId);
  assert.equal(v.state, 'unverifiable'); assert.match(v.next, /never assume it from chat words/);
});

test('N-03: one active handoff at a time; a second request returns the pending one', () => {
  const h = createHandoffs({tasks: createTaskLog({dir: dirOf()}), probe: {apps: async () => []}});
  const a = h.request({reason: 'a', what: 'a', verify: {kind: 'app_window', process: 'p'}});
  const b = h.request({reason: 'b', what: 'b', verify: {kind: 'app_window', process: 'p'}});
  assert.equal(b.handoffId, a.handoffId); assert.match(b.note, /already pending/);
});

test('session hold: idle lease cannot end the task while the owner acts; Live View frames off meanwhile; release restores', async () => {
  const c = clock(); const ended = [];
  const s = createSession({caps: {live_view: true}, now: c.now, setIntervalFn: () => null, clearIntervalFn: () => {}, idleMs: 45_000});
  s.onEnd(async r => { ended.push(r); return {}; });
  await s.around('mouse_action', async () => {});
  assert.equal(s.liveActive(), true);
  assert.equal(s.hold('handoff:h-1', 600_000, {pauseLive: true}), true);
  assert.equal(s.liveActive(), false); assert.deepEqual(s.status().heldFor, ['handoff:h-1']);
  c.add(300_000); await s.tick();
  assert.deepEqual(ended, [], 'no lease_expired during the handoff');
  s.release('handoff:h-1'); assert.equal(s.liveActive(), true);
  c.add(10_000); await s.tick(); assert.deepEqual(ended, [], 'release renews the lease');
  c.add(46_000); await s.tick(); assert.deepEqual(ended, ['lease_expired']);
  // a hold is bounded: it cannot keep a session alive forever
  await s.around('mouse_action', async () => {}); s.hold('h', 1000);
  c.add(50_000); await s.tick(); assert.deepEqual(ended, ['lease_expired', 'lease_expired']);
});

test('N-08 idempotency: an external op that ran is shown as ПОВТОР (also after Host restart); reads are not journaled', () => {
  const dir = dirOf();
  const mk = () => { const t = createTaskLog({dir}); return {t, c: createConsent({journal: {keyFor: (w, x) => (isExternal(w, x) ? idemKey(w, x) : null), alreadyDone: k => t.alreadyDone(k)}})}; };
  const {t, c} = mk();
  const target = 'браузер NEXUS: нажать «Place order» на shop.test (может создать платное обязательство)';
  const first = c.requestGrant({what: 'browser_financial', target, apply: () => ({done: true})});
  assert.equal(first.target, target); assert.equal(first.alreadyDone, undefined);
  const p = c.take(first.consentId, 'allow', target);
  assert.equal(p.idemKey, idemKey('browser_financial', target));
  t.recordOp({key: p.idemKey, what: 'browser_financial', target: p.baseTarget, ok: true});
  const second = c.requestGrant({what: 'browser_financial', target, apply: () => ({})});
  assert.match(second.target, /^ПОВТОР \(уже выполнено 20\d\d-\d\d-\d\d \d\d:\d\d UTC\): браузер NEXUS/);
  assert.ok(second.alreadyDone); assert.match(second.warning, /ALREADY RAN/);
  assert.throws(() => c.take(second.consentId, 'allow', target), /consent_target_mismatch/, 'old target text cannot confirm a repeat');
  // Host restart: the journal is rebuilt from tasks/*.json
  const r2 = mk();
  assert.match(r2.c.requestGrant({what: 'browser_financial', target, apply: () => ({})}).target, /^ПОВТОР/);
  // not external: reading a protected file / app access
  assert.equal(isExternal('protected_file', 'чтение защищённого ресурса «.env»'), false);
  assert.equal(isExternal('protected_file', 'удаление (в .nexus-trash) защищённого ресурса «.env»'), true);
  assert.equal(isExternal('app_access', 'x'), false);
  // a failed op does not count as done
  const k2 = idemKey('system_tool', 'z'); r2.t.recordOp({key: k2, what: 'system_tool', target: 'z', ok: false});
  assert.equal(r2.t.alreadyDone(k2), null);
});

test('N-08 checkpoint file: stage, ops, handoffs, created, errors — and no secrets / typed text / args', () => {
  const dir = dirOf(); const t = createTaskLog({dir});
  t.stage('keyboard_action', 'sess1');
  t.created(['NEXUS-abc.txt'], 'open_app:notepad');
  t.recordOp({key: 'k', what: 'executor_file_write', target: 'запись в «.env» token=ghp_abcdefghijklmnopqrstuvwxyz0123456789', ok: true});
  t.error('mouse_action', 'owner_handoff_active');
  const id = t.close('client_cancelled');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));
  assert.equal(saved.status, 'interrupted'); assert.equal(saved.endReason, 'client_cancelled'); assert.equal(saved.session, 'sess1');
  assert.equal(saved.stage.tool, 'keyboard_action'); assert.equal(saved.ops.length, 1); assert.equal(saved.errors[0].code, 'owner_handoff_active');
  assert.doesNotMatch(JSON.stringify(saved), /ghp_abcdefghij/, 'secrets redacted in checkpoint');
  const t2 = createTaskLog({dir});
  assert.equal(t2.lastInterrupted().task, id, 'resumable info is found after a restart');
});

test('runtime e2e: Notepad cold start → handoff; input paused; owner opens Notepad → verified; checkpoint visible; finish closes task', async () => {
  const home = fs.mkdtempSync(path.join(tmp, 'home-'));
  const cfg = loadConfig({NEXUS_HOME: home, NEXUS_TOKEN: 'x'.repeat(40), NEXUS_WORKSPACE: path.join(home, 'ws'),
    NEXUS_CAPABILITIES_JSON: JSON.stringify({gui_input: true, screen_capture: true, ui_read: true})});
  fs.mkdirSync(cfg.workspace, {recursive: true});
  let notepad = [];
  const runUia = async a => (a.mode === 'apps' ? {apps: a.name === 'notepad' ? notepad : []} : {});
  const launched = [];
  const launcher = (exe, args) => { launched.push(exe); return {pid: 1, once: (ev, fn) => { if (ev === 'spawn') setImmediate(fn); }, unref() {}}; };
  cfg.runtime = createRuntime(cfg, {guiDeps: {platform: 'win32', runUia}, appsDeps: {platform: 'win32', systemRoot: 'C:\\Windows', launcher, exists: () => true, wait: async () => {}},
    handoffDeps: {pollMs: 30, stepMs: 10}, sessionDeps: {setIntervalFn: () => null}});
  const call = async (name, args = {}) => {
    const r = await handleRpc({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: args}}, cfg);
    return r.result.isError ? {error: r.result.content[0].text} : r.result.structuredContent;
  };
  const h = await call('open_app', {app: 'notepad'});
  assert.equal(h.status, 'owner_action_required'); assert.equal(h.started, false); assert.equal(launched.length, 0);
  assert.match(h.handoffId, /^h-/);
  assert.match((await call('mouse_action', {action: 'click', x: 1, y: 1})).error, /owner_handoff_active.*task_status/);
  assert.match((await call('capture_screen', {})).error, /owner_handoff_active/);
  const st = await call('task_status', {});
  assert.equal(st.ownerAction.handoffId, h.handoffId); assert.equal(st.checkpoint.status, 'waiting_owner');
  assert.equal((await call('task_status', {id: h.handoffId})).state, 'waiting_owner');
  assert.equal(cfg.runtime.session.active(), true, 'session kept while waiting');
  notepad = [{hwnd: 5, pid: 9, process: 'Notepad', name: 'owner', tabs: []}];
  const done = await call('task_status', {id: h.handoffId});
  assert.equal(done.state, 'done'); assert.match(done.next, /open_app/);
  assert.equal((await call('mouse_action', {action: 'nope'})).error.includes('owner_handoff_active'), false, 'input no longer paused');
  const fin = await call('finish_task');
  assert.equal(fin.taskStatus, 'finished');
  const files = fs.readdirSync(path.join(home, 'tasks')).filter(f => f.endsWith('.json'));
  const saved = files.map(f => JSON.parse(fs.readFileSync(path.join(home, 'tasks', f), 'utf8'))).find(t => t.handoffs.length);
  assert.equal(saved.status, 'finished'); assert.equal(saved.handoffs[0].state, 'done'); assert.equal(saved.handoffs[0].resume, 'open_app');
  assert.doesNotMatch(JSON.stringify(saved), /"args"/, 'resume args are not written to disk');
  cfg.runtime.stop();
});
