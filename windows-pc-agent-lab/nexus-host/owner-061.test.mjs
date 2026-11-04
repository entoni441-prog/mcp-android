// NEXUS 0.6.1 (owner decision 04.11.2026, NX-052-36 / FR-10): everything available by default, ordinary consents run
// autonomously, ONLY the owner list waits for the owner's tap on the Live View page — the model can never approve it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createConsent, OWNER_WHATS} from './consent.mjs';
import {classifyApp} from './policy.mjs';
import {createGui} from './gui.mjs';
import {validateCapabilities} from './capabilities.mjs';

test('owner list is exactly: money, sending/deleting on his behalf, secrets, irreversible deletion, Windows security, lifting his ban', () => {
  assert.deepEqual([...OWNER_WHATS].sort(), ['browser_financial', 'browser_irreversible', 'destructive_action', 'destructive_command', 'owner_unban',
    'protected_app', 'protected_file', 'secret_access', 'security_command', 'security_page']);
});

test('autonomy: an ordinary grant runs at once (no consentId), audited auto_approved, journaled', async () => {
  const log = [], ops = [];
  const c = createConsent({autonomy: true, audit: e => log.push(e), journal: {keyFor: () => 'k1', alreadyDone: () => null, record: r => ops.push(r)}});
  let ran = 0;
  for (const what of ['app_access', 'file_outside_scope', 'arbitrary_command', 'software_change', 'command_plan', 'system_power', 'executor_file_write', 'system_tool']) {
    const r = await c.requestGrant({what, target: 't-' + what, apply: async () => { ran++; return {ok: what}; }});
    assert.deepEqual(r, {ok: what}, what);
  }
  assert.equal(ran, 8); assert.equal(c.pendingCount(), 0);
  assert.equal(log.filter(e => e.event === 'auto_approved').length, 8);
  assert.equal(ops.length, 8); assert.ok(ops.every(o => o.ok === true && o.key === 'k1'));
});

test('autonomy: a repeat of an external operation that already ran is never silent', async () => {
  const c = createConsent({autonomy: true, journal: {keyFor: () => 'k', alreadyDone: () => ({at: '2026-11-04T08:00:00Z', task: 't'})}});
  let ran = 0;
  const r = await c.requestGrant({what: 'software_change', target: 'winget install X', apply: () => { ran++; }});
  assert.equal(r.status, 'consent_required'); assert.match(r.target, /^ПОВТОР/); assert.equal(ran, 0);
});

test('owner tier: the model cannot approve; only ownerDecide (gateway /live) does; 10 min; cancel by owner; mismatch refused', async () => {
  let t = 0;
  const log = [];
  const c = createConsent({autonomy: true, now: () => t, audit: e => log.push(e)});
  let ran = 0;
  for (const what of OWNER_WHATS) {
    const r = await c.requestGrant({what, target: 'x ' + what, apply: () => { ran++; return {done: true}; }});
    assert.equal(r.status, 'consent_required', what); assert.equal(r.approval, 'owner_phone', what);
    assert.equal(r.expiresInSec, 600); assert.match(r.instruction, /Never approve or simulate approval yourself/);
    assert.throws(() => c.take(r.consentId, 'allow', r.target), /owner_approval_pending/, what);
  }
  assert.equal(ran, 0);
  const list = c.ownerList();
  assert.equal(list.length, OWNER_WHATS.size); assert.ok(list.every(x => x.decided === null && x.expiresInSec === 600));
  const [a, b] = list;
  assert.throws(() => c.ownerDecide(a.consentId, 'close_discard'), /invalid_args/);
  assert.throws(() => c.ownerDecide('nope', 'allow'), /consent_expired_or_unknown/);
  c.ownerDecide(a.consentId, 'allow');
  assert.ok(log.some(e => e.event === 'owner_decision' && e.via === 'live_page' && e.consentId === a.consentId));
  const p = c.take(a.consentId, 'allow', a.target);
  assert.deepEqual(await p.apply(), {done: true}); assert.equal(ran, 1);
  assert.throws(() => c.take(a.consentId, 'allow', a.target), /consent_expired_or_unknown/, 'single use');
  c.ownerDecide(b.consentId, 'cancel');
  assert.equal(c.take(b.consentId, 'allow', b.target).cancelledByOwner, true);
  t = 601_000;
  assert.deepEqual(c.ownerList(), [], 'expired after 10 min');
});

test('owner tier: closing a window/tab NEXUS did not open (owner unsaved data) waits for his tap with his chosen decision', () => {
  const c = createConsent({autonomy: true});
  const g = c.gate({kind: 'window', via: 'alt+f4'}, {hwnd: 7, process: 'Notepad', name: 'Документ', tabs: []}, null, {tool: 'keyboard_action', args: {keys: 'alt+f4'}});
  assert.equal(g.approval, 'owner_phone'); assert.deepEqual(g.options, ['close_discard', 'close_save', 'cancel']);
  assert.throws(() => c.take(g.consentId, 'close_discard', g.target), /owner_approval_pending/);
  c.ownerDecide(g.consentId, 'close_save');
  assert.throws(() => c.take(g.consentId, 'close_discard', g.target), /owner_decision_mismatch/);
  assert.equal(c.take(g.consentId, 'close_save', g.target).c.kind, 'window');
});

test('without autonomy (unit default) the legacy chat consent stays unchanged', async () => {
  const c = createConsent();
  const r = await c.requestGrant({what: 'app_access', target: 'x', apply: () => 1});
  assert.equal(r.status, 'consent_required'); assert.equal(r.approval, undefined);
});

test('agent apps: Claude/ChatGPT/Antigravity/Grok are GUI targets; every typed prompt is reported for the journal (secrets masked)', async () => {
  for (const p of ['claude', 'Claude.exe', 'ChatGPT', 'Antigravity', 'grok']) assert.equal(classifyApp(p).cls, 'agent', p);
  for (const p of ['powershell', 'WindowsTerminal', 'cmd']) assert.equal(classifyApp(p).cls, 'deny', p);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-061-'));
  const ctx = {ok: true, process: 'claude', pid: 50, type: 'Edit', name: 'Prompt'};
  const uia = async a => (a.mode === 'focused' ? {focused: ctx} : {focused: ctx, window: {hwnd: 9, pid: 50, process: 'claude', name: 'Claude', tabs: []}, elem: {type: 'Edit', name: 'Prompt'}});
  const robot = {start: async () => {}, cmd: async () => ({ok: true, clipboardRestored: true}), stop() {}};
  const g = createGui({caps: validateCapabilities({}), home: tmp, workspace: tmp, platform: 'win32', runUia: uia, robot, sleep: async () => {}});
  const r = await g.keyboard_action({text: 'check the build, token=ghp_' + 'A'.repeat(36)});
  assert.equal(r.done, true); assert.equal(r.agentPrompt.app, 'claude');
  assert.match(r.agentPrompt.preview, /check the build/); assert.ok(!r.agentPrompt.preview.includes('A'.repeat(36)), 'secret masked in the journal');
});

test('NEXUS never types or clicks into the owner approval page (its approval must be the owner tap)', async () => {
  const {appGate} = await import('./policy.mjs');
  const caps = validateCapabilities({});
  assert.deepEqual(appGate(caps, 'msedge', {title: 'NEXUS Live View — Личный: Microsoft Edge', mode: 'input'}), {allow: false, error: 'owner_handoff_required', reason: 'owner_approval_page'});
  assert.equal(appGate(caps, 'msedge', {title: 'NEXUS Live View', mode: 'read'}).allow, true);
  assert.equal(appGate(caps, 'msedge', {title: 'Новости', mode: 'input'}).allow, true);
});
