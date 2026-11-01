import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDefault, handleTunnel, handleMcp, sha256hex} from '../src/handlers.mjs';
import {fakeGuardNamespace} from './fake-guard.mjs';

const BASE = 'https://nexus-gateway.example.workers.dev';
const TOKEN = 't'.repeat(43);
const PASS = 'correct horse battery staple 2026';

function makeEnv() {
  const kv = new Map();
  const completed = [];
  return {
    kv, completed,
    env: {
      NEXUS_TOKEN: TOKEN,
      CONSENT_GUARD: fakeGuardNamespace().ns,
      OAUTH_KV: {
        get: async k => kv.has(k) ? kv.get(k) : null,
        put: async (k, v) => { kv.set(k, v); },
        delete: async k => { kv.delete(k); },
      },
      OAUTH_PROVIDER: {
        parseAuthRequest: async () => ({clientId: 'chatgpt', redirectUri: 'https://chatgpt.com/cb', scope: [], state: 's'}),
        lookupClient: async id => id === 'chatgpt' ? {clientName: 'ChatGPT <b>'} : null,
        completeAuthorization: async (o) => { completed.push(o); return {redirectTo: 'https://chatgpt.com/cb?code=abc&state=s'}; },
      },
    },
  };
}
const withPass = async env => ({...env, OWNER_PASSPHRASE_SHA256: await sha256hex(PASS)});
const nonceFrom = html => /name="nonce" value="([a-f0-9]{64})"/.exec(html)[1];
const post = (nonce, passphrase, decision = 'approve') => new Request(BASE + '/authorize', {method: 'POST', body: new URLSearchParams({nonce, passphrase, decision})});

test('consent page escapes client name and issues single-use nonce', async () => {
  const {env: e} = makeEnv(); const env = await withPass(e);
  const html = await (await handleDefault(new Request(BASE + '/authorize?x=1'), env)).text();
  assert.match(html, /ChatGPT &lt;b&gt;/);
  assert.ok(nonceFrom(html));
});

test('consent form CSP allows only self and the client callback origin', async () => {
  const m = makeEnv(); const env = await withPass(m.env);
  const csp = async redirectUri => {
    env.OAUTH_PROVIDER.parseAuthRequest = async () => ({clientId: 'chatgpt', redirectUri, scope: [], state: 's'});
    return (await handleDefault(new Request(BASE + '/authorize'), env)).headers.get('content-security-policy');
  };
  assert.match(await csp('https://chatgpt.com/cb?x=1'), /form-action 'self' https:\/\/chatgpt\.com;/);
  assert.match(await csp('http://127.0.0.1:9000/cb'), /form-action 'self' http:\/\/127\.0\.0\.1:9000;/);
  for (const bad of ['http://evil.com/cb', 'myapp://localhost/cb', 'not a url'])
    assert.match(await csp(bad), /form-action 'self';/, bad);
  const errors = await handleDefault(post('0'.repeat(64), PASS), env);
  assert.match(errors.headers.get('content-security-policy'), /form-action 'self';/);
});

test('correct passphrase completes authorization exactly once', async () => {
  const m = makeEnv(); const env = await withPass(m.env);
  const nonce = nonceFrom(await (await handleDefault(new Request(BASE + '/authorize'), env)).text());
  const r = await handleDefault(post(nonce, PASS), env);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://chatgpt.com/cb?code=abc&state=s');
  assert.deepEqual(m.completed[0].props, {owner: true});
  assert.equal((await handleDefault(post(nonce, PASS), env)).status, 400, 'nonce replay');
  assert.equal(m.completed.length, 1);
});

test('wrong passphrase rejected and lockout after 5 failures', async () => {
  const m = makeEnv(); const env = await withPass(m.env);
  for (let i = 0; i < 5; i++) {
    const nonce = nonceFrom(await (await handleDefault(new Request(BASE + '/authorize'), env)).text());
    assert.equal((await handleDefault(post(nonce, 'wrong'), env)).status, 403);
  }
  const nonce = nonceFrom(await (await handleDefault(new Request(BASE + '/authorize'), env)).text());
  assert.equal((await handleDefault(post(nonce, PASS), env)).status, 429, 'locked even with correct pass');
  assert.equal(m.kv.has('consent-fails'), false, 'no KV counter any more');
  assert.equal(m.completed.length, 0);
});

test('deny and unconfigured gateway never authorize', async () => {
  const m = makeEnv(); const env = await withPass(m.env);
  const nonce = nonceFrom(await (await handleDefault(new Request(BASE + '/authorize'), env)).text());
  assert.equal((await handleDefault(post(nonce, PASS, 'deny'), env)).status, 403);
  assert.equal((await handleDefault(new Request(BASE + '/authorize'), m.env)).status, 503, 'no passphrase hash configured');
  assert.equal(m.completed.length, 0);
});

const tunnelReq = (method, body, token = TOKEN) => new Request(BASE + '/tunnel', {method, headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'}, body: body && JSON.stringify(body)});

test('tunnel registration requires PC token and a trycloudflare URL', async () => {
  const m = makeEnv();
  assert.equal((await handleTunnel(tunnelReq('POST', {url: 'https://abc-def.trycloudflare.com'}, 'x'.repeat(43)), m.env)).status, 401);
  for (const url of ['http://abc.trycloudflare.com', 'https://evil.com', 'https://a.trycloudflare.com.evil.com', 'https://abc.trycloudflare.com/x'])
    assert.equal((await handleTunnel(tunnelReq('POST', {url}), m.env)).status, 400, url);
  assert.equal((await handleTunnel(tunnelReq('POST', {url: 'https://abc-def.trycloudflare.com'}), m.env)).status, 200);
  assert.equal(JSON.parse(m.kv.get('tunnel')).url, 'https://abc-def.trycloudflare.com');
  assert.equal((await handleTunnel(tunnelReq('DELETE'), m.env)).status, 200);
  assert.ok(!m.kv.has('tunnel'));
});

const rpc = (method, id = 1, params) => new Request(BASE + '/mcp', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id, method, ...(params ? {params} : {})})});
const callTool = (id = 1) => rpc('tools/call', id, {name: 'get_status', arguments: {}});

test('mcp forwards tools/call to PC with Bearer token; offline → tool error, not protocol error', async () => {
  const m = makeEnv(); const ctx = {props: {owner: true}};
  const off = await (await handleMcp(callTool(7), m.env, ctx)).json();
  assert.equal(off.id, 7); assert.equal(off.error, undefined); assert.equal(off.result.isError, true); assert.match(off.result.content[0].text, /pc_offline/);
  m.kv.set('tunnel', JSON.stringify({url: 'https://abc-def.trycloudflare.com'}));
  let seen;
  const fetcher = async (url, init) => { seen = {url, init}; return new Response('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}', {status: 200, headers: {'content-type': 'application/json'}}); };
  const r = await handleMcp(callTool(), m.env, ctx, {fetcher});
  assert.equal(r.status, 200);
  assert.equal(seen.url, 'https://abc-def.trycloudflare.com/mcp');
  assert.equal(seen.init.headers.authorization, 'Bearer ' + TOKEN);
  assert.deepEqual(await r.json(), {jsonrpc: '2.0', id: 1, result: {tools: []}});
});

test('mcp rejects non-owner props, GET, oversized body; maps tunnel failures to offline', async () => {
  const m = makeEnv();
  m.kv.set('tunnel', JSON.stringify({url: 'https://abc-def.trycloudflare.com'}));
  assert.equal((await handleMcp(rpc('ping'), m.env, {props: {}})).status, 403);
  assert.equal((await handleMcp(new Request(BASE + '/mcp'), m.env, {props: {owner: true}})).status, 405);
  const big = new Request(BASE + '/mcp', {method: 'POST', body: 'x'.repeat(70000)});
  assert.equal((await handleMcp(big, m.env, {props: {owner: true}})).status, 413);
  const down = async () => { throw new Error('ECONNREFUSED'); };
  assert.match((await (await handleMcp(callTool(), m.env, {props: {owner: true}}, {fetcher: down})).json()).result.content[0].text, /pc_offline/);
  const cf530 = async () => new Response('tunnel gone', {status: 530});
  assert.match((await (await handleMcp(callTool(), m.env, {props: {owner: true}}, {fetcher: cf530})).json()).result.content[0].text, /pc_offline/);
});

test('secrets with trailing CR/LF (PowerShell pipe) still work', async () => {
  const m = makeEnv(); const env = {...m.env, NEXUS_TOKEN: TOKEN + '\r\n', OWNER_PASSPHRASE_SHA256: (await sha256hex(PASS)).toUpperCase() + '\n'};
  assert.equal((await handleTunnel(tunnelReq('POST', {url: 'https://abc-def.trycloudflare.com'}), env)).status, 200);
  const nonce = nonceFrom(await (await handleDefault(new Request(BASE + '/authorize'), env)).text());
  assert.equal((await handleDefault(post(nonce, PASS), env)).status, 302);
  let auth; await handleMcp(callTool(), env, {props: {owner: true}}, {fetcher: async (u, i) => { auth = i.headers.authorization; return new Response('{}'); }});
  assert.equal(auth, 'Bearer ' + TOKEN);
});

test('PC offline: initialize, notifications, ping and tools/list still work (connector can register)', async () => {
  const m = makeEnv(); const ctx = {props: {owner: true}};
  let forwarded = 0; const fetcher = async () => { forwarded++; return new Response('{}'); };
  const init = await (await handleMcp(rpc('initialize', 1, {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'chatgpt', version: '1'}}), m.env, ctx, {fetcher})).json();
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'nexus-host');
  assert.equal((await handleMcp(new Request(BASE + '/mcp', {method: 'POST', body: JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'})}), m.env, ctx, {fetcher})).status, 202);
  assert.deepEqual((await (await handleMcp(rpc('ping', 2), m.env, ctx, {fetcher})).json()).result, {});
  const list = await (await handleMcp(rpc('tools/list', 3), m.env, ctx, {fetcher})).json();
  assert.deepEqual(list.result.tools.map(t => t.name), ['get_status', 'list_dir', 'read_text', 'make_dir', 'write_text', 'open_app', 'list_windows']);
  assert.equal(forwarded, 0, 'nothing forwarded to the PC');
  assert.equal((await (await handleMcp(rpc('resources/list', 4), m.env, ctx)).json()).error.code, -32601);
  assert.equal((await (await handleMcp(rpc('tools/call', 5, {name: 'run_shell', arguments: {}}), m.env, ctx)).json()).error.message, 'unknown_tool');
  assert.equal((await handleMcp(new Request(BASE + '/mcp', {method: 'POST', body: '{bad'}), m.env, ctx)).status, 400);
});

test('non-http(s) redirect URI never widens form-action', async () => {
  const {env: e} = makeEnv(); const env = await withPass(e);
  const bad = {...env, OAUTH_PROVIDER: {...env.OAUTH_PROVIDER, parseAuthRequest: async () => ({clientId: 'chatgpt', redirectUri: 'javascript:alert(1)', scope: []})}};
  assert.match((await handleDefault(new Request(BASE + '/authorize'), bad)).headers.get('content-security-policy'), /form-action 'self';/);
});
