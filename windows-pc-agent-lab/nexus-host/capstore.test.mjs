// NEXUS 0.4.1 — live permission switches: no restart, fail-safe on broken file, everything audited.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCapStore, SETTABLE} from './capstore.mjs';
import {loadCapabilities} from './capabilities.mjs';
import {loadConfig, createServer} from './server.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-cap-'));
const bump = f => { const t = new Date(Date.now() + Math.floor(Math.random() * 100000) + 2000); fs.utimesSync(f, t, t); };
function fresh() {
  const home = fs.mkdtempSync(path.join(tmp, 'h-'));
  const {file, caps} = loadCapabilities(home);
  const log = [];
  return {home, file, log, store: createCapStore({file, initial: caps, audit: e => log.push(e)})};
}
const rewrite = (file, patch) => { const j = JSON.parse(fs.readFileSync(file, 'utf8')); fs.writeFileSync(file, JSON.stringify({...j, ...patch}, null, 2)); bump(file); };

test('0.6.1: every owner switch is settable from chat; non-switch keys and bad values are refused', () => {
  assert.deepEqual(SETTABLE, ['screen_capture', 'ui_read', 'gui_input', 'process_control', 'run_task', 'browser', 'live_view', 'diagnostics', 'commands', 'power', 'lockAfterTask']);
  const {store} = fresh();
  for (const [k, v] of [['inputApps', ['cmd']], ['grantsFromChat', false], ['logonChannelVerified', true], ['taskRoots', []], ['gui_input', 'yes'], ['gui_input', 1]]) {
    assert.throws(() => store.set(k, v), /invalid_args/, k);
  }
});

test('0.6.1: available by default; turning a switch off is the owner ban (file + audit), turning it on lifts the ban', () => {
  const {file, log, store} = fresh();
  for (const k of ['gui_input', 'process_control', 'run_task', 'browser', 'live_view', 'commands', 'power']) assert.equal(store.view[k], true, k);
  assert.deepEqual([...store.view.taskRoots], [os.homedir()]);
  const r = store.set('commands', false);
  assert.deepEqual(r, {capability: 'commands', enabled: false, previous: true, changed: true, ownerBan: true});
  assert.equal(store.isBanned('commands'), true);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(j.commands, false); assert.deepEqual(j.ownerBans, ['commands']); assert.equal(j._profile, 2); assert.match(j._comment, /NEXUS/);
  assert.deepEqual(log.at(-1), {event: 'capabilities_changed', source: 'tool', changes: {commands: [true, false], ownerBans: [[], ['commands']]}});
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter(n => n.endsWith('.tmp')), []);
  store.set('commands', true, 'owner_live');
  assert.equal(store.view.commands, true); assert.equal(store.isBanned('commands'), false);
  assert.equal(store.set('commands', true).changed, false);
});

test('owner edits the file on the PC → picked up without restart, audited with source=file', () => {
  const {file, log, store} = fresh();
  rewrite(file, {browser: false});
  store.refresh();
  assert.equal(store.view.browser, false);
  assert.deepEqual(log.at(-1), {event: 'capabilities_changed', source: 'file', changes: {browser: [true, false]}});
});

test('broken or invalid file is never applied: permissions stay, error audited, chat switch refused', () => {
  const {file, log, store} = fresh();
  store.set('gui_input', true);
  for (const bad of ['{not json', JSON.stringify({gui_input: 'on'}), JSON.stringify({gui_input: false, evil: true}),
    JSON.stringify({tasks: {x: {exe: 'C:\\Windows\\System32\\cmd.exe'}}})]) {
    fs.writeFileSync(file, bad); bump(file);
    store.refresh();
    assert.equal(store.view.gui_input, true, bad);           // old permissions kept, nothing new enabled
    assert.equal(log.at(-1).event, 'capabilities_reload_failed', bad);
    assert.equal(log.at(-1).kept, 'current');
    assert.throws(() => store.set('gui_input', false), /capabilities_file_invalid/);
    assert.ok(store.status().fileError);
  }
  fs.rmSync(file); store.refresh();
  assert.equal(log.at(-1).error, 'file_missing');
  assert.equal(store.view.gui_input, true);
});

test('live view: modules see the new value without being recreated', () => {
  const {store} = fresh();
  const view = store.view;
  assert.equal(view.gui_input, true);
  store.set('gui_input', false);
  assert.equal(view.gui_input, false);
  assert.throws(() => { 'use strict'; view.gui_input = true; });
  assert.deepEqual([...view.inputApps], ['Notepad', 'CalculatorApp']);
});

test('0.6.1 end to end over HTTP: owner ban by word is immediate; lifting it waits for the owner tap (/live), not the model', async () => {
  const home = path.join(tmp, 'e2e-home');
  const cfg = loadConfig({NEXUS_HOME: home, NEXUS_WORKSPACE: path.join(tmp, 'e2e-ws'), NEXUS_PORT: '0'});
  const server = createServer(cfg, {platform: 'linux'});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  let id = 0;
  const call = async (name, args) => (await (await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${cfg.token}`},
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method: 'tools/call', params: {name, arguments: args}})})).json()).result;
  try {
    assert.equal((await call('get_capabilities', {})).structuredContent.grants.gui_input, true);
    assert.doesNotMatch((await call('keyboard_action', {keys: 'enter'})).content[0].text, /capability_disabled/);
    const off = await call('set_capability', {capability: 'gui_input', enabled: false});
    assert.equal(off.isError, false); assert.equal(off.structuredContent.ownerBan, true);
    assert.match((await call('keyboard_action', {keys: 'enter'})).content[0].text, /capability_disabled/);
    // the model asks to lift the owner's ban → waits for the owner, the model cannot approve it
    const ask = (await call('set_capability', {capability: 'gui_input', enabled: true})).structuredContent;
    assert.equal(ask.status, 'consent_required'); assert.equal(ask.what, 'owner_unban'); assert.equal(ask.approval, 'owner_phone');
    const early = await call('confirm_action', {consentId: ask.consentId, decision: 'allow', target: ask.target});
    assert.equal(early.isError, true); assert.match(early.content[0].text, /owner_approval_pending/);
    assert.match((await call('keyboard_action', {keys: 'enter'})).content[0].text, /capability_disabled/);
    // the owner's channel (gateway /live page) — same Host endpoint, names not in the model catalog
    const list = (await call('owner_consents', {})).structuredContent.pending;
    assert.deepEqual(list.map(x => [x.consentId, x.what]), [[ask.consentId, 'owner_unban']]);
    assert.equal((await call('owner_decide', {consentId: ask.consentId, decision: 'allow'})).isError, false);
    const done = await call('confirm_action', {consentId: ask.consentId, decision: 'allow', target: ask.target});
    assert.equal(done.isError, false); assert.equal(done.structuredContent.result.enabled, true);
    assert.doesNotMatch((await call('keyboard_action', {keys: 'enter'})).content[0].text, /capability_disabled/);
    const lines = fs.readFileSync(cfg.auditFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(lines.filter(l => l.event === 'capabilities_changed').map(c => c.changes.gui_input), [[true, false], [false, true]]);
    assert.ok(lines.some(l => l.event === 'owner_decision' && l.via === 'live_page'));
    assert.equal((await call('read_text', {path: 'missing.txt'})).content[0].text, 'error: not_found');
  } finally { server.close(); cfg.runtime?.stop(); }
});
