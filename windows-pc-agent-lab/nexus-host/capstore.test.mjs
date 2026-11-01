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

test('only gui_input is switchable from chat', () => {
  assert.deepEqual(SETTABLE, ['gui_input']);
  const {store} = fresh();
  for (const [k, v] of [['browser', true], ['run_task', true], ['process_control', true], ['inputApps', ['cmd']], ['gui_input', 'yes'], ['gui_input', 1]]) {
    assert.throws(() => store.set(k, v), /invalid_args/, k);
  }
});

test('set gui_input: applied immediately, written atomically to file, audited, other keys preserved', () => {
  const {file, log, store} = fresh();
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(store.view.gui_input, false);
  const r = store.set('gui_input', true);
  assert.deepEqual(r, {capability: 'gui_input', enabled: true, previous: false, changed: true});
  assert.equal(store.view.gui_input, true);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(j.gui_input, true);
  assert.equal(j.browser, false); assert.match(j._comment, /NEXUS/);
  assert.equal(JSON.parse(before).process_control, j.process_control);
  assert.deepEqual(log.at(-1), {event: 'capabilities_changed', source: 'tool', changes: {gui_input: [false, true]}});
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter(n => n.endsWith('.tmp')), []);
  store.set('gui_input', false);
  assert.equal(store.view.gui_input, false);
  assert.deepEqual(log.at(-1).changes, {gui_input: [true, false]});
  const again = store.set('gui_input', false);
  assert.equal(again.changed, false);
  assert.equal(log.length, 2); // no-op is not logged as a change
});

test('owner edits the file on the PC → picked up without restart, audited with source=file', () => {
  const {file, log, store} = fresh();
  rewrite(file, {browser: true});
  store.refresh();
  assert.equal(store.view.browser, true);
  assert.deepEqual(log.at(-1), {event: 'capabilities_changed', source: 'file', changes: {browser: [false, true]}});
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
  assert.equal(view.gui_input, false);
  store.set('gui_input', true);
  assert.equal(view.gui_input, true);
  assert.throws(() => { 'use strict'; view.gui_input = false; });
  assert.deepEqual([...view.inputApps], ['Notepad', 'CalculatorApp']);
});

test('end to end over HTTP: keyboard refused → set_capability → allowed path reached → off again; audit has every step', async () => {
  const home = path.join(tmp, 'e2e-home');
  const cfg = loadConfig({NEXUS_HOME: home, NEXUS_WORKSPACE: path.join(tmp, 'e2e-ws'), NEXUS_PORT: '0'});
  const server = createServer(cfg, {platform: 'linux'});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  let id = 0;
  const call = async (name, args) => (await (await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${cfg.token}`},
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method: 'tools/call', params: {name, arguments: args}})})).json()).result;
  try {
    assert.equal((await call('get_capabilities', {})).structuredContent.gui_input, false);
    assert.match((await call('keyboard_action', {keys: 'enter'})).content[0].text, /capability_disabled/);
    const on = await call('set_capability', {capability: 'gui_input', enabled: true});
    assert.equal(on.isError, false); assert.equal(on.structuredContent.enabled, true);
    // Same running Host, no restart: the capability gate now passes (fails later only because this test runs on Linux).
    assert.doesNotMatch((await call('mouse_action', {action: 'move', x: 1, y: 1})).content[0].text, /capability_disabled/); // gate passed (what follows depends on the desktop; `move` never clicks or types)
    assert.equal((await call('set_capability', {capability: 'browser', enabled: true})).isError, true);
    assert.equal((await call('set_capability', {capability: 'gui_input', enabled: true, extra: 1})).isError, true);
    await call('set_capability', {capability: 'gui_input', enabled: false});
    assert.match((await call('keyboard_action', {keys: 'enter'})).content[0].text, /capability_disabled/);
    const lines = fs.readFileSync(cfg.auditFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const changes = lines.filter(l => l.event === 'capabilities_changed');
    assert.deepEqual(changes.map(c => c.changes.gui_input), [[false, true], [true, false]]);
    assert.ok(lines.some(l => l.tool === 'set_capability' && l.ok === true && l.args.enabled === true));
    assert.ok(lines.some(l => l.tool === 'set_capability' && l.ok === false && l.args.capability === 'browser'));
    assert.equal((await call('read_text', {path: 'missing.txt'})).content[0].text, 'error: not_found');
  } finally { server.close(); cfg.runtime?.stop(); }
});
