// 0.4.2: pc_offline reason codes, distinct pc_timeout, single retry for read-only tools only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMcp} from '../src/handlers.mjs';

const TUNNEL = 'https://abc-def-ghi.trycloudflare.com';
const env = (tunnel = {url: TUNNEL, registeredAt: Date.now() - 5000}) => ({NEXUS_TOKEN: 't'.repeat(43), OAUTH_KV: {get: async () => tunnel ? JSON.stringify(tunnel) : null}});
const ctx = {props: {owner: true}};
const call = (name, e, fetcher) => handleMcp(new Request('https://gw/mcp', {method: 'POST', body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: {}}})}), e, ctx, {fetcher}).then(r => r.json());
const text = j => j.result.content[0].text;
const ok = () => new Response(JSON.stringify({jsonrpc: '2.0', id: 1, result: {content: [{type: 'text', text: 'ok'}]}}), {status: 200, headers: {'content-type': 'application/json'}});

test('no registration / bad url → reason in text, still contains pc_offline', async () => {
  assert.match(text(await call('get_status', env(null), async () => ok())), /pc_offline.*\[reason: no_tunnel_registered\]/);
  assert.match(text(await call('get_status', env({url: 'https://evil.example.com'}), async () => ok())), /bad_tunnel_url/);
});

test('edge 530 on a read-only tool: one retry, then success', async () => {
  let n = 0;
  const j = await call('get_status', env(), async () => (++n === 1 ? new Response('', {status: 530}) : ok()));
  assert.equal(n, 2); assert.equal(text(j), 'ok');
});

test('edge 530 on a state-changing tool: NO retry (a click must never run twice)', async () => {
  let n = 0;
  const j = await call('mouse_action', env(), async () => { n++; return new Response('', {status: 530}); });
  assert.equal(n, 1);
  assert.match(text(j), /pc_offline.*reason: edge_530_registered_\d+s_ago/);
});

test('network error: read-only retried once, write tool not; reason tunnel_unreachable', async () => {
  let n = 0;
  assert.match(text(await call('list_windows', env(), async () => { n++; throw new TypeError('network'); })), /tunnel_unreachable/);
  assert.equal(n, 2);
  n = 0;
  assert.match(text(await call('keyboard_action', env(), async () => { n++; throw new TypeError('network'); })), /tunnel_unreachable/);
  assert.equal(n, 1);
});

test('timeout is reported as pc_timeout (not offline) and never retried', async () => {
  let n = 0;
  const j = await call('get_status', env(), async () => { n++; throw Object.assign(new Error('t'), {name: 'TimeoutError'}); });
  assert.equal(n, 1);
  assert.match(text(j), /^pc_timeout: .*may still have run/);
  assert.equal(j.result.isError, true);
});

test('host 5xx / 404 reasons', async () => {
  assert.match(text(await call('mouse_action', env(), async () => new Response('', {status: 500}))), /host_500/);
  assert.match(text(await call('mouse_action', env(), async () => new Response('', {status: 404}))), /host_404/);
});

// ── NEXUS NEXT: Sentinel (pre-logon state) + verdicts ────────────────────────────────────────────────────────────
import {handleSentinel, pcVerdict} from '../src/handlers.mjs';
test('NEXT sentinel: separate token, strict body, stored; verdicts distinguish logon screen / locked / host offline / tunnel 530', async () => {
  const kv = new Map(); const env = {OAUTH_KV: {get: async k => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v), delete: async k => kv.delete(k)}, SENTINEL_TOKEN: 's'.repeat(40), NEXUS_TOKEN: 'n'.repeat(40)};
  const req = (body, tok = 's'.repeat(40)) => new Request('https://g.example/sentinel', {method: 'POST', headers: {authorization: 'Bearer ' + tok, 'content-type': 'application/json'}, body: JSON.stringify(body)});
  const ok = {state: 'logon_screen', bootAt: '2026-11-03T10:00:00Z', at: '2026-11-03T10:02:00Z'};
  assert.equal((await handleSentinel(req(ok, 'n'.repeat(40)), env)).status, 401, 'the NEXUS token is not the sentinel token');
  assert.equal((await handleSentinel(req({...ok, state: 'run_cmd'}), env)).status, 400);
  assert.equal((await handleSentinel(req(ok), env)).status, 200);
  assert.equal(JSON.parse(kv.get('sentinel')).state, 'logon_screen');
  assert.equal((await handleSentinel(req(ok), {OAUTH_KV: env.OAUTH_KV})).status, 503, 'no SENTINEL_TOKEN → endpoint disabled');
  const t = Date.now(), S = state => ({state, reportedAt: t - 30_000});
  assert.equal(pcVerdict({probeStatus: 530, sentinel: S('logon_screen'), now: t}).verdict, 'awaiting_owner_logon');
  assert.equal(pcVerdict({probeStatus: 0, sentinel: S('locked'), now: t}).verdict, 'pc_locked');
  assert.equal(pcVerdict({probeStatus: 530, sentinel: S('user_session'), now: t}).verdict, 'host_offline');
  assert.equal(pcVerdict({probeStatus: 530, sentinel: {state: 'user_session', reportedAt: t - 10 * 60_000}, now: t}).verdict, 'tunnel_unavailable', 'stale sentinel ignored');
  assert.equal(pcVerdict({probeStatus: 530, registrationStale: true, sentinel: null, now: t}).verdict, 'pc_offline_stale_registration');
  assert.equal(pcVerdict({probeStatus: 200, sentinel: S('host_up'), now: t}), null);
});
