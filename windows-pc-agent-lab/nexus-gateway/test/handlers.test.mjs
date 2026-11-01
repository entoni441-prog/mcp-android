import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDefault, handleTunnel, handleMcp, sha256hex} from '../src/handlers.mjs';

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

const rpc = (method, id = 1) => new Request(BASE + '/mcp', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id, method})});

test('mcp forwards to PC with Bearer token; offline when no tunnel', async () => {
  const m = makeEnv(); const ctx = {props: {owner: true}};
  const off = await (await handleMcp(rpc('tools/list', 7), m.env, ctx)).json();
  assert.equal(off.id, 7); assert.match(off.error.message, /pc_offline/);
  m.kv.set('tunnel', JSON.stringify({url: 'https://abc-def.trycloudflare.com'}));
  let seen;
  const fetcher = async (url, init) => { seen = {url, init}; return new Response('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}', {status: 200, headers: {'content-type': 'application/json'}}); };
  const r = await handleMcp(rpc('tools/list'), m.env, ctx, {fetcher});
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
  assert.match((await (await handleMcp(rpc('ping'), m.env, {props: {owner: true}}, {fetcher: down})).json()).error.message, /pc_offline/);
  const cf530 = async () => new Response('tunnel gone', {status: 530});
  assert.match((await (await handleMcp(rpc('ping'), m.env, {props: {owner: true}}, {fetcher: cf530})).json()).error.message, /pc_offline/);
});

test('secrets with trailing CR/LF (PowerShell pipe) still work', async () => {
  const m = makeEnv(); const env = {...m.env, NEXUS_TOKEN: TOKEN + '\r\n', OWNER_PASSPHRASE_SHA256: (await sha256hex(PASS)).toUpperCase() + '\n'};
  assert.equal((await handleTunnel(tunnelReq('POST', {url: 'https://abc-def.trycloudflare.com'}), env)).status, 200);
  const nonce = nonceFrom(await (await handleDefault(new Request(BASE + '/authorize'), env)).text());
  assert.equal((await handleDefault(post(nonce, PASS), env)).status, 302);
  let auth; await handleMcp(rpc('ping'), env, {props: {owner: true}}, {fetcher: async (u, i) => { auth = i.headers.authorization; return new Response('{}'); }});
  assert.equal(auth, 'Bearer ' + TOKEN);
});
