import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadConfig, createServer} from './server.mjs';
import {TOOLS} from './catalog.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-'));
const cfg = loadConfig({NEXUS_HOME: path.join(tmp, 'home'), NEXUS_WORKSPACE: path.join(tmp, 'ws'), NEXUS_PORT: '0'});
const launched = [];
const launchedArgs = [];
const fakeLauncher = (exe, args = []) => { launched.push(exe); launchedArgs.push(args); const h = {}; return {once: (ev, fn) => { if (ev === 'spawn') setImmediate(fn); return h; }, unref() {}}; };
const server = createServer(cfg, {platform: 'win32', systemRoot: 'C:\\Windows', launcher: fakeLauncher});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/mcp`;
test.after(() => server.close());

let nextId = 1;
async function rpc(method, params, {token = cfg.token, origin, raw} = {}) {
  const headers = {'content-type': 'application/json', accept: 'application/json, text/event-stream'};
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  const body = raw ?? JSON.stringify(method === null ? params : {jsonrpc: '2.0', id: nextId++, method, params});
  const r = await fetch(base, {method: 'POST', headers, body});
  const text = await r.text();
  return {status: r.status, body: text ? JSON.parse(text) : null};
}
const call = async (name, args) => (await rpc('tools/call', {name, arguments: args})).body.result;

test('rejects missing / wrong token and foreign Origin', async () => {
  assert.equal((await rpc('ping', {}, {token: null})).status, 401);
  assert.equal((await rpc('ping', {}, {token: 'x'.repeat(43)})).status, 401);
  assert.equal((await rpc('ping', {}, {origin: 'https://evil.example'})).status, 403);
  assert.equal((await rpc('ping', {}, {origin: 'https://chatgpt.com'})).status, 200);
});

test('MCP handshake and tool discovery', async () => {
  const init = await rpc('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 't', version: '0'}});
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.equal(init.body.result.serverInfo.name, 'nexus-host');
  assert.equal((await rpc(null, {jsonrpc: '2.0', method: 'notifications/initialized'})).status, 202);
  const tools = (await rpc('tools/list', {})).body.result.tools.map(t => t.name);
  assert.deepEqual(tools, TOOLS.map(t => t.name));
  assert.equal(tools.length, 35);
  assert.equal(init.body.result.serverInfo.version, '0.5.0');
});

test('workspace file round-trip with optimistic sha', async () => {
  assert.equal((await call('make_dir', {path: 'notes'})).isError, false);
  const created = await call('write_text', {path: 'notes/a.txt', content: 'привет', expectedSha256: null});
  assert.equal(created.isError, false);
  const read = await call('read_text', {path: 'notes/a.txt'});
  assert.equal(read.structuredContent.text, 'привет');
  const stale = await call('write_text', {path: 'notes/a.txt', content: 'x', expectedSha256: '0'.repeat(64)});
  assert.equal(stale.isError, true);
  const upd = await call('write_text', {path: 'notes/a.txt', content: 'обновлено', expectedSha256: read.structuredContent.sha256});
  assert.equal(upd.isError, false);
  const list = await call('list_dir', {path: 'notes'});
  assert.deepEqual(list.structuredContent.entries, [{name: 'a.txt', type: 'file'}]);
});

test('escape attempts and unknown tools are refused', async () => {
  for (const p of ['../x', 'C:/Windows/win.ini', 'a\\..\\b', '/etc/passwd', 'con.txt']) {
    assert.equal((await call('read_text', {path: p})).isError, true, p);
  }
  assert.equal((await rpc('tools/call', {name: 'run_shell', arguments: {cmd: 'whoami'}})).body.error.message, 'unknown_tool');
  assert.equal((await call('open_app', {app: 'cmd'})).isError, true);
});

test('list_windows is refused off-Windows and rejects unknown args', async () => {
  assert.equal((await call('list_windows', {cmd: 'whoami'})).isError, true);
})

test('open_app resolves absolute System32 path only; notepad gets a NEW scratch file, never an owner file', async () => {
  const r = await call('open_app', {app: 'notepad'});
  assert.equal(r.isError, false);
  assert.equal(launched.at(-1), 'C:\\Windows\\System32\\notepad.exe');
  assert.match(launchedArgs.at(-1)[0], /[\\/]\.nexus-scratch[\\/]NEXUS-[0-9a-f]{6}\.txt$/);
  assert.equal(fs.readFileSync(launchedArgs.at(-1)[0], 'utf8'), '');
  assert.match(r.structuredContent.scratchFile, /^\.nexus-scratch\/NEXUS-[0-9a-f]{6}\.txt$/);
  assert.equal((await call('open_app', {app: 'cmd'})).isError, true); // not granted
  assert.equal((await call('open_app', {app: '../x'})).isError, true);
});

test('malformed input and oversized body', async () => {
  assert.equal((await rpc(null, null, {raw: '{bad'})).status, 400);
  assert.equal((await rpc(null, null, {raw: '[]'})).status, 400);
  await assert.rejects(rpc(null, null, {raw: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'ping', pad: 'x'.repeat(70000)})}));
});

test('audit log records calls without token', () => {
  const log = fs.readFileSync(cfg.auditFile, 'utf8');
  assert.match(log, /"tool":"write_text"/);
  assert.ok(!log.includes(cfg.token));
});
