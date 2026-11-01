import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {loadConfig, createServer} from './server.mjs';
import {findCloudflared, loadGateway, registerTunnel} from './nexus.mjs';
import {handleMcp, handleTunnel} from '../nexus-gateway/src/handlers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function kvEnv(token) {
  const kv = new Map();
  return {kv, env: {NEXUS_TOKEN: token, OAUTH_KV: {get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); }}}};
}

test('gateway → host: real JSON-RPC round-trip with token check', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-e2e-'));
  const cfg = loadConfig({NEXUS_HOME: path.join(tmp, 'h'), NEXUS_WORKSPACE: path.join(tmp, 'ws')});
  const host = createServer(cfg);
  await new Promise(r => host.listen(0, '127.0.0.1', r));
  const local = `http://127.0.0.1:${host.address().port}`;
  // Stand-in for the quick tunnel: rewrite the public trycloudflare URL to the local host.
  const tunnelFetch = (url, init) => fetch(url.replace('https://abc-def.trycloudflare.com', local), init);
  try {
    const {env} = kvEnv(cfg.token);
    const reg = new Request('https://gw.workers.dev/tunnel', {method: 'POST', headers: {authorization: 'Bearer ' + cfg.token}, body: JSON.stringify({url: 'https://abc-def.trycloudflare.com'})});
    assert.equal((await handleTunnel(reg, env)).status, 200);
    const call = (body, e = env) => handleMcp(new Request('https://gw.workers.dev/mcp', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}), e, {props: {owner: true}}, {fetcher: tunnelFetch});

    const init = await (await call({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'chatgpt', version: '1'}}})).json();
    assert.equal(init.result.serverInfo.name, 'nexus-host');
    const w = await (await call({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'write_text', arguments: {path: 'via-gateway.txt', content: 'ok', expectedSha256: null}}})).json();
    assert.equal(w.result.isError, false);
    assert.equal(fs.readFileSync(path.join(cfg.workspace, 'via-gateway.txt'), 'utf8'), 'ok');
    assert.equal((await call({jsonrpc: '2.0', method: 'notifications/initialized'})).status, 202);

    // Gateway holding a wrong token gets 401 from the host, never results.
    const {env: badEnv} = kvEnv('w'.repeat(43)); badEnv.OAUTH_KV.put('tunnel', JSON.stringify({url: 'https://abc-def.trycloudflare.com'}));
    assert.equal((await call({jsonrpc: '2.0', id: 3, method: 'tools/list'}, badEnv)).status, 401);
  } finally { host.close(); }
});

test('launcher helpers: cloudflared lookup, gateway config validation, registration call', async () => {
  assert.equal(findCloudflared({'ProgramFiles(x86)': 'C:\\PF86'}, p => p === 'C:\\PF86\\cloudflared\\cloudflared.exe'), 'C:\\PF86\\cloudflared\\cloudflared.exe');
  assert.equal(findCloudflared({}, () => false), null);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-gw-'));
  assert.throws(() => loadGateway(home), /gateway_json_missing/);
  fs.writeFileSync(path.join(home, 'gateway.json'), JSON.stringify({url: 'https://evil.example.com'}));
  assert.throws(() => loadGateway(home), /invalid_gateway_url/);
  fs.writeFileSync(path.join(home, 'gateway.json'), JSON.stringify({url: 'https://nexus-gateway.antoni.workers.dev'}));
  assert.equal(loadGateway(home), 'https://nexus-gateway.antoni.workers.dev');
  let seen; await registerTunnel('https://g.workers.dev', 'tok', 'https://x.trycloudflare.com', {fetcher: async (u, i) => { seen = {u, i}; return {ok: true}; }});
  assert.equal(seen.u, 'https://g.workers.dev/tunnel'); assert.equal(seen.i.headers.authorization, 'Bearer tok');
});

test('launcher end-to-end with fake cloudflared: registers tunnel, unregisters on stop', {skip: process.platform === 'win32' && 'sh wrapper is POSIX-only'}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-launch-'));
  const home = path.join(tmp, 'h'); fs.mkdirSync(home);
  const calls = [];
  const gw = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { calls.push({method: req.method, auth: req.headers.authorization, body: b}); res.end('{}'); }); });
  await new Promise(r => gw.listen(0, '127.0.0.1', r));
  // Fake cloudflared prints a quick-tunnel URL like the real one and waits.
  const fake = path.join(tmp, 'fake-cloudflared.mjs');
  fs.writeFileSync(fake, "console.error('INF |  https://fake-tunnel-123.trycloudflare.com  |'); setInterval(()=>{},1000);");
  const wrapper = path.join(tmp, 'cloudflared'); fs.writeFileSync(wrapper, `#!/bin/sh\nexec node ${fake}\n`, {mode: 0o755});
  fs.writeFileSync(path.join(home, 'gateway.json'), JSON.stringify({url: 'https://placeholder.workers.dev'}));
  // Route gateway calls to the local stub via a tiny preload that patches fetch.
  const preload = path.join(tmp, 'preload.mjs');
  fs.writeFileSync(preload, `const real=globalThis.fetch;globalThis.fetch=(u,i)=>real(String(u).replace('https://placeholder.workers.dev','http://127.0.0.1:${gw.address().port}'),i);`);
  const child = spawn(process.execPath, ['--import', preload, path.join(here, 'nexus.mjs')], {env: {...process.env, NEXUS_HOME: home, NEXUS_WORKSPACE: path.join(tmp, 'ws'), NEXUS_PORT: '0', NEXUS_CLOUDFLARED: wrapper}, stdio: ['ignore', 'pipe', 'pipe']});
  let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
  try {
    for (let i = 0; i < 100 && !out.includes('ChatGPT access: ON'); i++) await new Promise(r => setTimeout(r, 100));
    assert.match(out, /ChatGPT access: ON/);
    const token = fs.readFileSync(path.join(home, 'token.txt'), 'utf8').trim();
    assert.deepEqual(calls[0], {method: 'POST', auth: 'Bearer ' + token, body: JSON.stringify({url: 'https://fake-tunnel-123.trycloudflare.com'})});
    child.kill('SIGINT');
    await new Promise(r => child.once('exit', r));
    assert.equal(calls.at(-1).method, 'DELETE');
    assert.ok(!out.includes(token), 'token never printed');
  } finally { child.kill('SIGKILL'); gw.close(); }
});
