// capabilities, catalog, files, processes/tasks, audit, server wiring (all platforms).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateCapabilities, loadCapabilities, DEFAULT_CAPABILITIES, isHardDenied} from './capabilities.mjs';
import {TOOLS, VERSION} from './catalog.mjs';
import {searchFiles, fileAction} from './files.mjs';
import {createProcs, parseTasklistCsv} from './procs.mjs';
import {createRuntime, auditArgs, handleRpc} from './server.mjs';
import {urlAllowed} from './browser.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-mod-'));
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

// ── catalog ──
test('gateway catalog is a byte-identical copy of the host catalog', () => {
  const a = fs.readFileSync(path.join(HERE, 'catalog.mjs'));
  const b = fs.readFileSync(path.join(HERE, '..', 'nexus-gateway', 'src', 'catalog.mjs'));
  assert.ok(a.equals(b), 'run: cp nexus-host/catalog.mjs nexus-gateway/src/catalog.mjs');
  assert.equal(VERSION, '0.6.1-next');
});

test('every catalog tool has an implementation and a strict input schema', () => {
  const rt = createRuntime({home: tmp, workspace: path.join(tmp, 'ws'), caps: validateCapabilities({})});
  const legacy = ['get_status', 'list_dir', 'read_text', 'make_dir', 'write_text', 'open_app', 'list_windows'];
  assert.equal(new Set(TOOLS.map(t => t.name)).size, TOOLS.length);
  for (const t of TOOLS) {
    assert.ok(legacy.includes(t.name) || typeof rt.handlers[t.name] === 'function', t.name);
    assert.equal(t.inputSchema.type, 'object'); assert.equal(t.inputSchema.additionalProperties, false, t.name);
    for (const r of t.inputSchema.required || []) assert.ok(Object.hasOwn(t.inputSchema.properties, r), t.name + '.' + r);
  }
  // 0.6.1: owner-only handlers (gateway /live page) are deliberately NOT in the model catalog
  assert.deepEqual(Object.keys(rt.handlers).filter(n => !TOOLS.some(t => t.name === n)), ['owner_consents', 'owner_decide']);
  rt.stop();
});

// ── capabilities ──
test('0.6.1 defaults: everything available (owner restricts by command); first run writes the file outside the workspace', () => {
  const home = path.join(tmp, 'home1'); fs.mkdirSync(home);
  const {file, caps, migrated} = loadCapabilities(home);
  assert.ok(fs.existsSync(file)); assert.equal(migrated, null);
  for (const k of ['gui_input', 'process_control', 'run_task', 'browser', 'live_view', 'commands', 'power', 'screen_capture']) assert.equal(caps[k], true, k);
  assert.deepEqual([...caps.taskRoots], [os.homedir()]); assert.deepEqual([...caps.ownerBans], []);
  assert.deepEqual(caps.inputApps, ['Notepad', 'CalculatorApp']);
  fs.writeFileSync(file, JSON.stringify({...JSON.parse(fs.readFileSync(file, 'utf8')), gui_input: false, ownerBans: ['gui_input']}));
  assert.equal(loadCapabilities(home).caps.gui_input, false); // second run reads, does not overwrite the owner's ban
});

test('0.6.1 migration: an old profile (defaults OFF) becomes available once; owner data kept; backup written; idempotent', () => {
  const home = path.join(tmp, 'home-mig'); fs.mkdirSync(home);
  const file = path.join(home, 'capabilities.json');
  const old = {_comment: 'old', screen_capture: true, gui_input: true, process_control: false, run_task: false, browser: true, live_view: true,
    commands: false, power: false, taskRoots: [], blockedApps: ['mspaint'], protectedPaths: [path.join(home, 'secret')], limits: {maxCommands: 2}};
  fs.writeFileSync(file, JSON.stringify(old));
  const {caps, migrated} = loadCapabilities(home);
  assert.deepEqual(Object.keys(migrated.changes).sort(), ['commands', 'power', 'process_control', 'run_task', 'taskRoots']);
  for (const k of ['process_control', 'run_task', 'commands', 'power']) assert.equal(caps[k], true, k);
  assert.deepEqual([...caps.blockedApps], ['mspaint']); assert.equal(caps.limits.maxCommands, 2); assert.deepEqual([...caps.taskRoots], [os.homedir()]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'capabilities.pre-0.6.1.json'), 'utf8')), old);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))._profile, 2);
  assert.equal(loadCapabilities(home).migrated, null);
  // a broken old file is never migrated (fail closed)
  const h2 = path.join(tmp, 'home-mig2'); fs.mkdirSync(h2);
  fs.writeFileSync(path.join(h2, 'capabilities.json'), JSON.stringify({gui_input: 'yes'}));
  assert.throws(() => loadCapabilities(h2), /invalid_capabilities/);
  assert.equal(fs.existsSync(path.join(h2, 'capabilities.pre-0.6.1.json')), false);
});

test('capabilities validation fails closed and hard-deny cannot be overridden', () => {
  for (const bad of [{gui_input: 'yes'}, {unknown: 1}, {inputApps: 'Notepad'}, {inputApps: ['a b']}, {tasks: []},
    {tasks: {x: {exe: 'relative.exe'}}}, {tasks: {x: {exe: 'C:\\Windows\\System32\\cmd.exe'}}}, {tasks: {x: {exe: 'C:\\t\\build.cmd'}}},
    {tasks: {x: {exe: 'C:\\t\\run.ps1'}}}, {tasks: {x: {exe: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'}}}, {tasks: {x: {exe: '\\\\server\\share\\a.exe'}}},
    {tasks: {'Bad Name': {exe: 'C:\\a.exe'}}}, {tasks: {x: {exe: 'C:\\a.exe', timeoutSec: 0}}}, {tasks: {x: {exe: 'C:\\a.exe', args: 'x'}}}]) {
    assert.throws(() => validateCapabilities(bad), /invalid_capabilities/, JSON.stringify(bad));
  }
  assert.deepEqual(validateCapabilities({inputApps: ['powershell', 'cmd.exe', 'Notepad', 'WindowsTerminal']}).inputApps, ['Notepad']);
  for (const n of ['PowerShell.exe', 'cmd', 'consent', 'pwsh', 'WindowsTerminal', 'regedit', 'mshta']) assert.ok(isHardDenied(n), n);
  assert.equal(isHardDenied('Notepad'), false);
  assert.ok(Object.isFrozen(DEFAULT_CAPABILITIES));
  const home = path.join(tmp, 'home2'); fs.mkdirSync(home); fs.writeFileSync(path.join(home, 'capabilities.json'), '{broken');
  assert.throws(() => loadCapabilities(home));
});

// ── files ──
test('search_files and file_action stay in the workspace, never overwrite, delete is recoverable', () => {
  const workspace = path.join(tmp, 'ws-files'); fs.mkdirSync(path.join(workspace, 'a', 'b'), {recursive: true});
  fs.writeFileSync(path.join(workspace, 'a', 'Report-1.txt'), 'x'); fs.writeFileSync(path.join(workspace, 'a', 'b', 'report-2.md'), 'y');
  const ctx = {workspace};
  assert.deepEqual(searchFiles({query: 'report'}, ctx).results.map(r => r.path).sort(), ['a/Report-1.txt', 'a/b/report-2.md']);
  assert.equal(fileAction({action: 'copy', path: 'a/Report-1.txt', to: 'a/copy.txt'}, ctx).to, 'a/copy.txt');
  assert.throws(() => fileAction({action: 'copy', path: 'a/Report-1.txt', to: 'a/copy.txt'}, ctx), /destination_exists/);
  assert.equal(fileAction({action: 'rename', path: 'a/copy.txt', to: 'renamed.txt'}, ctx).to, 'a/renamed.txt');
  assert.throws(() => fileAction({action: 'rename', path: 'a/renamed.txt', to: 'b/x.txt'}, ctx), /rename_takes_a_name/);
  assert.equal(fileAction({action: 'move', path: 'a/renamed.txt', to: 'moved.txt'}, ctx).to, 'moved.txt');
  const del = fileAction({action: 'delete', path: 'moved.txt'}, ctx);
  assert.match(del.to, /^\.nexus-trash\/.+-moved\.txt$/);
  assert.ok(fs.existsSync(path.join(workspace, ...del.to.split('/'))));
  assert.equal(searchFiles({query: 'moved'}, ctx).results.length, 0); // trash hidden
  for (const bad of [{action: 'copy', path: '../x', to: 'y'}, {action: 'move', path: 'a', to: 'C:/x'}, {action: 'delete', path: 'a/Report-1.txt', to: 'x'},
    {action: 'chmod', path: 'a'}, {action: 'copy', path: 'a\\b', to: 'z'}]) assert.throws(() => fileAction(bad, ctx), /invalid_args/, JSON.stringify(bad));
  assert.throws(() => fileAction({action: 'delete', path: del.to}, ctx), /trash_protected/);
  assert.throws(() => fileAction({action: 'move', path: 'a', to: 'a/b/inside'}, ctx), /destination_inside_source/);
  assert.throws(() => searchFiles({query: 'x', path: '..'}, ctx), /invalid_args/);
});

// ── processes / tasks ──
test('tasklist CSV parsing (localized memory formats)', () => {
  const rows = parseTasklistCsv('"Notepad.exe","4242","Console","1","23.456 K"\r\n"System Idle Process","0","Services","0","8 K"\r\n"x.exe","7","Console","1","1 234 K"\r\ngarbage');
  assert.deepEqual(rows[0], {process: 'Notepad', pid: 4242, session: 1, memKB: 23456});
  assert.equal(rows[2].memKB, 1234);
});

function procsWith(capsRaw, list) {
  const calls = [];
  const exec = async (exe, args) => { calls.push([path.win32.basename(exe), ...args]); return {code: 0, out: list}; };
  const cfg = {workspace: tmp, auditFile: path.join(tmp, 'audit.log')};
  return {calls, p: createProcs({caps: validateCapabilities(capsRaw), cfg, platform: 'win32', systemRoot: 'C:\\Windows', exec})};
}
const LIST = '"Notepad.exe","50","Console","1","10 K"\r\n"powershell.exe","66","Console","1","10 K"\r\n"chrome.exe","70","Console","1","10 K"\r\n"helper.exe","80","Console","1","10 K"';

test('process_action: capability, allowlist, kill only NEXUS-owned, never terminals', async () => {
  await assert.rejects(procsWith({process_control: false}, LIST).p.process_action({pid: 50, action: 'close'}), /capability_disabled/);
  const {p, calls} = procsWith({process_control: true}, LIST);
  assert.equal((await p.process_action({pid: 50, action: 'close'})).requested, true);
  assert.deepEqual(calls.at(-1), ['taskkill.exe', '/pid', '50']);
  await assert.rejects(p.process_action({pid: 66, action: 'close'}), /process_not_allowed/);
  await assert.rejects(procsWith({process_control: true, appAccess: 'allowlist'}, LIST).p.process_action({pid: 70, action: 'close'}), /process_not_allowed/);
  assert.equal((await p.process_action({pid: 70, action: 'close'})).requested, true, '0.5.2 policy mode: any ordinary app (runtime asks the owner for non-owned)');
  await assert.rejects(procsWith({process_control: true, blockedApps: ['chrome']}, LIST).p.process_action({pid: 70, action: 'close'}), /process_not_allowed/);
  await assert.rejects(p.process_action({pid: 50, action: 'kill'}), /process_not_allowed/);
  p.registerOwned(80, 'task:x');
  await p.process_action({pid: 80, action: 'kill'});
  assert.deepEqual(calls.at(-1), ['taskkill.exe', '/pid', '80', '/t', '/f']);
  await assert.rejects(p.process_action({pid: 999, action: 'close'}), /process_not_found/);
  await assert.rejects(p.process_action({pid: 50, action: 'suspend'}), /invalid_args/);
});

test('list_processes filters and marks NEXUS-owned', async () => {
  const {p} = procsWith({}, LIST);
  p.registerOwned(80, 'x');
  const r = await p.list_processes({nameFilter: 'HELP'});
  assert.deepEqual(r.processes.map(x => [x.process, x.ownedByNexus]), [['helper', true]]);
});

test('run_task: only owner-defined tasks, no args from chat, real process, status and cancel', async () => {
  const isWin = process.platform === 'win32';
  const exe = isWin ? path.join(process.env.SystemRoot, 'System32', 'whoami.exe') : '/bin/echo';
  const sleepExe = isWin ? path.join(process.env.SystemRoot, 'System32', 'ping.exe') : '/bin/sleep';
  const caps = validateCapabilities({run_task: true, tasks: {hello: {exe, args: isWin ? [] : ['nexus-ok']}, slow: {exe: sleepExe, args: isWin ? ['-n', '30', '127.0.0.1'] : ['30']}}});
  const cfg = {workspace: tmp, auditFile: path.join(tmp, 'audit.log')};
  const p = createProcs({caps, cfg});
  await assert.rejects(p.run_task({task: 'rm'}), /unknown_task/);
  await assert.rejects(p.run_task({task: 'hello', args: ['x']}), /invalid_args/);
  const {id} = await p.run_task({task: 'hello'});
  for (let i = 0; i < 50 && (await p.task_status({id})).state === 'running'; i++) await new Promise(r => setTimeout(r, 100));
  const st = await p.task_status({id});
  assert.equal(st.state, 'exited'); assert.equal(st.exitCode, 0);
  if (!isWin) assert.match(st.outputTail, /nexus-ok/); else assert.ok(st.outputTail.length > 0);
  const slow = await p.run_task({task: 'slow'});
  assert.equal((await p.task_cancel({id: slow.id})).state, 'cancelled');
  assert.deepEqual((await p.task_status({})).available, ['hello', 'slow']);
  await assert.rejects(createProcs({caps: validateCapabilities({run_task: false}), cfg}).run_task({task: 'hello'}), /capability_disabled/);
  p.stopAll();
});

test('read_audit_log returns the tail; audit never stores typed text', async () => {
  const auditFile = path.join(tmp, 'audit-tail.log');
  fs.writeFileSync(auditFile, Array.from({length: 300}, (_, i) => JSON.stringify({n: i})).join('\n') + '\n');
  const p = createProcs({caps: validateCapabilities({}), cfg: {workspace: tmp, auditFile}});
  const r = await p.read_audit_log({lines: 3});
  assert.deepEqual(r.entries.map(e => e.n), [297, 298, 299]);
  assert.deepEqual(auditArgs({text: 'secret words', content: 'abc', path: 'a.txt', x: 1}), {text: '<12 chars>', content: '<3 chars>', path: 'a.txt', x: 1});
});

test('server: disabled capability → tool error (not crash); audit line has no typed text', async () => {
  const home = path.join(tmp, 'home3'); fs.mkdirSync(home);
  const cfg = {home, workspace: path.join(tmp, 'ws3'), auditFile: path.join(home, 'audit.log'), caps: validateCapabilities({gui_input: false})};
  const r = await handleRpc({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'keyboard_action', arguments: {text: 'my password 123'}}}, cfg, {});
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /capability_disabled/);
  const log = fs.readFileSync(cfg.auditFile, 'utf8');
  assert.ok(!log.includes('my password'));
  assert.ok(log.includes('<15 chars>'));
  const img = await handleRpc({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'image_selftest', arguments: {}}}, cfg, {});
  assert.equal(img.result.content[0].type, 'image');
  assert.equal(img.result.structuredContent.width, 64);
  cfg.runtime?.stop();
});

// ── browser policy ──
test('browser URL policy: public http(s) only', () => {
  for (const ok of ['https://example.com/', 'http://example.org/a?b=1', 'https://8.8.8.8/']) assert.ok(urlAllowed(ok), ok);
  for (const bad of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'edge://settings', 'chrome://version', 'data:text/html,x', 'about:blank',
    'http://localhost:8765/mcp', 'http://127.0.0.1:8765/', 'http://[::1]/', 'http://192.168.1.1/', 'http://10.0.0.5/', 'http://172.20.1.1/',
    'http://169.254.169.254/', 'http://router/', 'http://nas.local/', 'https://user:pw@example.com/', 'http://[fd00::1]/', 'http://[::ffff:127.0.0.1]/']) assert.equal(urlAllowed(bad), false, bad);
  assert.ok(urlAllowed('http://127.0.0.1:9/', {allowPrivate: true}));
  assert.equal(urlAllowed('file:///x', {allowPrivate: true}), false);
});
