// 0.5.0 gateway: MCP Apps widget resource, connection_status, trace ids, external /live (login, session cookie,
// frame proxy, STOP, CSRF, lockout, nonce separation from OAuth). No network: fetcher is faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDefault, handleMcp, sha256hex, connectionStatus} from '../src/handlers.mjs';
import {fakeGuardNamespace} from './fake-guard.mjs';
import {WIDGET_HTML} from '../src/widget.mjs';
import {COOKIE, makeSession} from '../src/live-page.mjs';

const BASE = 'https://nexus-gateway.example.workers.dev';
const TOKEN = 'k'.repeat(43);
const PASS = 'owner pass phrase 0.5.0';
const TUN = 'https://abc-def-ghi.trycloudflare.com';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]).toString('base64');

async function env({registered = true, ageSec = 10} = {}) {
  const kv = new Map();
  if (registered) kv.set('tunnel', JSON.stringify({url: TUN, registeredAt: Date.now() - ageSec * 1000}));
  return {NEXUS_TOKEN: TOKEN, OWNER_PASSPHRASE_SHA256: await sha256hex(PASS), CONSENT_GUARD: fakeGuardNamespace().ns,
    OAUTH_KV: {get: async k => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v), delete: async k => kv.delete(k)},
    OAUTH_PROVIDER: {parseAuthRequest: async () => ({clientId: 'c', redirectUri: 'https://chatgpt.com/cb'}), lookupClient: async () => ({clientName: 'ChatGPT'}),
      completeAuthorization: async () => ({redirectTo: 'https://chatgpt.com/cb?code=1'})}};
}
function hostFake({liveState = 'live', healthz = 200, verdict = 'ok'} = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({url, init, body: init.body ? JSON.parse(init.body) : null});
    if (url.endsWith('/healthz')) return new Response(JSON.stringify({ok: true}), {status: healthz});
    const m = JSON.parse(init.body);
    const name = m.params.name;
    let result;
    if (name === 'live_frame') result = liveState === 'off' ? {content: [{type: 'text', text: '{}'}], structuredContent: {state: 'off'}} :
      {content: [{type: 'image', data: JPEG, mimeType: 'image/jpeg'}, {type: 'text', text: '{}'}], structuredContent: {state: 'live', imageW: 960, imageH: 540, cursor: {x: 1, y: 2}}};
    else if (name === 'live_control') result = {content: [], structuredContent: {state: 'off', stopped: true}};
    else if (name === 'connection_status') result = {content: [], structuredContent: {host: 'reachable', tunnel: {verdict}}};
    else result = {content: [{type: 'text', text: 'ok'}], structuredContent: {}};
    return new Response(JSON.stringify({jsonrpc: '2.0', id: m.id, result}), {status: 200, headers: {'content-type': 'application/json'}});
  };
  return {calls, fetcher};
}
const ctx = {props: {owner: true}};
const rpc = (method, params) => new Request(BASE + '/mcp', {method: 'POST', body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});

test('widget resource: MCP Apps mime, gateway-only direct owner auth domain, no secrets, no tunnel URL', async () => {
  const e = await env();
  const r = (await (await handleMcp(rpc('resources/read', {uri: 'ui://nexus/live-view-v1.html'}), e, ctx)).json()).result.contents[0];
  assert.equal(r.mimeType, 'text/html;profile=mcp-app');
  assert.deepEqual(r._meta.ui.csp.connectDomains, ['https://nexus-gateway.entoni441.workers.dev']); assert.deepEqual(r._meta.ui.csp.resourceDomains, []);
  assert.ok(!/trycloudflare|Bearer|NEXUS_TOKEN|localStorage|sessionStorage/.test(r.text));
  assert.match(r.text,/https:\/\/nexus-gateway\.entoni441\.workers\.dev/);;
  assert.match(r.text, /ui\/initialize/); assert.match(r.text, /live_frame/); assert.match(r.text, /live_control/);
  assert.ok(!/mouse_action|keyboard_action|set_capability/.test(WIDGET_HTML), 'widget has no control/raise-privilege path');
  assert.equal((await (await handleMcp(rpc('resources/read', {uri: 'ui://other'}), e, ctx)).json()).error.code, -32002);
  const init = (await (await handleMcp(rpc('initialize', {protocolVersion: '2025-06-18'}), e, ctx)).json()).result;
  assert.ok(init.capabilities.resources);
});

test('connection_status: answered by the gateway; verdicts; nothing secret', async () => {
  const none = (await connectionStatus(await env({registered: false}))).structuredContent;
  assert.equal(none.verdict, 'pc_not_connected');
  const h = hostFake({verdict: 'idle_timeouts_recovered'});
  const ok = (await connectionStatus(await env(), {fetcher: h.fetcher})).structuredContent;
  assert.equal(ok.verdict, 'online_with_recent_reconnects'); assert.equal(ok.tunnelProbe.status, 200);
  assert.ok(!JSON.stringify(ok).includes('trycloudflare'));
  const down = (await connectionStatus(await env({ageSec: 3600}), {fetcher: async () => new Response('', {status: 530})})).structuredContent;
  assert.equal(down.verdict, 'pc_offline_stale_registration');
  const blip = (await connectionStatus(await env(), {fetcher: async () => { throw Object.assign(Error('x'), {name: 'TypeError'}); }})).structuredContent;
  assert.equal(blip.verdict, 'tunnel_down_or_reconnecting');
  // via MCP: not forwarded as a normal tool
  const r = (await (await handleMcp(rpc('tools/call', {name: 'connection_status', arguments: {}}), await env({registered: false}), ctx)).json()).result;
  assert.equal(r.structuredContent.verdict, 'pc_not_connected');
});

test('trace id travels to the PC and appears in pc_offline / pc_timeout text', async () => {
  const h = hostFake();
  await handleMcp(rpc('tools/call', {name: 'get_status', arguments: {}}), await env(), ctx, {fetcher: h.fetcher});
  assert.match(h.calls[0].init.headers['x-nexus-trace'], /^[a-f0-9]{16}$/);
  const off = (await (await handleMcp(rpc('tools/call', {name: 'get_status', arguments: {}}), await env({registered: false}), ctx)).json()).result;
  assert.match(off.content[0].text, /pc_offline.*\[trace: [a-f0-9]{16}\]/);
  const slow = async () => { throw Object.assign(Error('t'), {name: 'TimeoutError'}); };
  const to = (await (await handleMcp(rpc('tools/call', {name: 'keyboard_action', arguments: {keys: 'enter'}}), await env(), ctx, {fetcher: slow})).json()).result;
  assert.match(to.content[0].text, /pc_timeout.*may still have run.*\[trace:/);
});

const loginNonce = async (e, f) => /name="nonce" value="([a-f0-9]{64})"/.exec(await (await handleDefault(new Request(BASE + '/live'), e, {fetcher: f})).text())[1];
const login = async (e, f, pass, n) => handleDefault(new Request(BASE + '/live/login', {method: 'POST', body: new URLSearchParams({nonce: n ?? await loginNonce(e, f), passphrase: pass})}), e, {fetcher: f});
const withCookie = (path, c, init = {}) => new Request(BASE + path, {...init, headers: {...(init.headers || {}), cookie: `${COOKIE}=${c}`}});

test('/live: login page CSP; wrong passphrase → 403; correct → secure session cookie; viewer page', async () => {
  const e = await env(); const h = hostFake();
  const page = await handleDefault(new Request(BASE + '/live'), e, {fetcher: h.fetcher});
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal((await login(e, h.fetcher, 'wrong')).status, 403);
  const ok = await login(e, h.fetcher, PASS);
  assert.equal(ok.status, 303);
  const sc = ok.headers.get('set-cookie');
  for (const f of ['__Host-nx_live=', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=1800']) assert.ok(sc.includes(f), f);
  const cookie = /__Host-nx_live=([^;]+)/.exec(sc)[1];
  const v = await handleDefault(withCookie('/live', cookie), e, {fetcher: h.fetcher});
  const html = await v.text();
  assert.match(html, /\/live\/frame/); assert.ok(!html.includes(TOKEN) && !html.includes('trycloudflare'));
  assert.match(v.headers.get('content-security-policy'), /script-src 'nonce-[A-Za-z0-9_-]+'/);
  assert.equal(h.calls.length, 0, 'login/page never contacts the PC');
});

test('/live/frame: 401 without/with tampered/expired cookie; JPEG bytes no-store; 409 when live_view off', async () => {
  const e = await env(); const h = hostFake();
  assert.equal((await handleDefault(new Request(BASE + '/live/frame'), e, {fetcher: h.fetcher})).status, 401);
  const good = await makeSession(e);
  const bad = good.slice(0, -2) + (good.endsWith('AA') ? 'BB' : 'AA');
  assert.equal((await handleDefault(withCookie('/live/frame', bad), e, {fetcher: h.fetcher})).status, 401);
  const expired = await makeSession(e, Date.now() - 31 * 60_000);
  assert.equal((await handleDefault(withCookie('/live/frame', expired), e, {fetcher: h.fetcher})).status, 401);
  assert.equal((await handleDefault(withCookie('/live/frame', await makeSession({...e, LIVE_SESSION_EPOCH: '2'})), e, {fetcher: h.fetcher})).status, 401, 'epoch bump revokes');
  assert.equal(h.calls.length, 0);
  const r = await handleDefault(withCookie('/live/frame?w=960', good), e, {fetcher: h.fetcher});
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg'); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())].slice(0, 3), [0xff, 0xd8, 0xff]);
  assert.equal(h.calls[0].body.params.name, 'live_frame'); assert.equal(h.calls[0].init.headers.authorization, 'Bearer ' + TOKEN);
  const off = hostFake({liveState: 'off'});
  assert.equal((await handleDefault(withCookie('/live/frame', good), e, {fetcher: off.fetcher})).status, 409);
  assert.equal((await handleDefault(withCookie('/live/frame', good), await env({registered: false}), {fetcher: h.fetcher})).status, 503);
});

test('/live/stop needs session + X-Nexus-Live header; forwards live_control stop', async () => {
  const e = await env(); const h = hostFake(); const c = await makeSession(e);
  assert.equal((await handleDefault(new Request(BASE + '/live/stop', {method: 'POST', headers: {'x-nexus-live': '1'}}), e, {fetcher: h.fetcher})).status, 401);
  assert.equal((await handleDefault(withCookie('/live/stop', c, {method: 'POST'}), e, {fetcher: h.fetcher})).status, 403);
  const r = await handleDefault(withCookie('/live/stop', c, {method: 'POST', headers: {'x-nexus-live': '1'}}), e, {fetcher: h.fetcher});
  assert.equal(r.status, 200);
  assert.deepEqual(h.calls.at(-1).body.params, {name: 'live_control', arguments: {action: 'stop'}});
  const lo = await handleDefault(withCookie('/live/logout', c, {method: 'POST', headers: {'x-nexus-live': '1'}}), e, {fetcher: h.fetcher});
  assert.match(lo.headers.get('set-cookie'), /Max-Age=0/);
});

test('/live lockout is shared with OAuth consent; nonces are not interchangeable', async () => {
  const e = await env(); const h = hostFake();
  for (let i = 0; i < 5; i++) await login(e, h.fetcher, 'nope');
  const locked = await login(e, h.fetcher, PASS);
  assert.equal(locked.status, 429, 'locked after 5 failures even with the right passphrase');
  const e2 = await env();
  const oauthNonce = /name="nonce" value="([a-f0-9]{64})"/.exec(await (await handleDefault(new Request(BASE + '/authorize'), e2)).text())[1];
  assert.equal((await login(e2, h.fetcher, PASS, oauthNonce)).status, 403, 'OAuth nonce cannot open a live session');
  const liveNonce = await loginNonce(e2, h.fetcher);
  const r = await handleDefault(new Request(BASE + '/authorize', {method: 'POST', body: new URLSearchParams({nonce: liveNonce, passphrase: PASS, decision: 'approve'})}), e2);
  assert.equal(r.status, 403, 'live nonce cannot complete OAuth');
});
