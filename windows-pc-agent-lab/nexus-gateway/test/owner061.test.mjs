// 0.6.1 gateway: owner approvals live ONLY on the passphrase-protected /live page; ChatGPT cannot reach the owner tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDefault, handleMcp, sha256hex} from '../src/handlers.mjs';
import {fakeGuardNamespace} from './fake-guard.mjs';
import {COOKIE, makeSession} from '../src/live-page.mjs';
import {TOOLS, VERSION} from '../src/catalog.mjs';

const BASE = 'https://nexus-gateway.example.workers.dev';
const TUN = 'https://abc-def-ghi.trycloudflare.com';
const PEND = [{consentId: 'a1b2c3d4e5f6', what: 'browser_financial', kind: 'grant', target: 'купить X', options: ['allow', 'cancel'], decided: null, expiresInSec: 540}];
async function env() {
  const kv = new Map([['tunnel', JSON.stringify({url: TUN, registeredAt: Date.now()})]]);
  return {NEXUS_TOKEN: 'k'.repeat(43), OWNER_PASSPHRASE_SHA256: await sha256hex('pass'), CONSENT_GUARD: fakeGuardNamespace().ns,
    OAUTH_KV: {get: async k => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v), delete: async k => kv.delete(k)}};
}
function hostFake() {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const m = JSON.parse(init.body); calls.push(m.params);
    const result = m.params.name === 'owner_consents' ? {content: [], structuredContent: {pending: PEND}} :
      m.params.name === 'owner_decide' ? {content: [], structuredContent: {consentId: m.params.arguments.consentId, decision: m.params.arguments.decision}} : {content: [], structuredContent: {}};
    return new Response(JSON.stringify({jsonrpc: '2.0', id: m.id, result}), {status: 200, headers: {'content-type': 'application/json'}});
  };
  return {calls, fetcher};
}
const withCookie = (path, c, init = {}) => new Request(BASE + path, {...init, headers: {...(init.headers || {}), cookie: `${COOKIE}=${c}`}});

test('0.6.1 catalog: version, 44 tools, owner tools are NOT offered to the model', () => {
  assert.equal(VERSION, '0.6.1-next'); assert.equal(TOOLS.length, 45);
  assert.equal(TOOLS.some(t => t.name === 'minimize_window'), true);
  for (const n of ['owner_consents', 'owner_decide']) assert.ok(!TOOLS.some(t => t.name === n), n);
  assert.deepEqual(TOOLS.find(t => t.name === 'set_capability').inputSchema.properties.capability.enum,
    ['screen_capture', 'ui_read', 'gui_input', 'process_control', 'run_task', 'browser', 'live_view', 'diagnostics', 'commands', 'power', 'lockAfterTask']);
});

test('ChatGPT (OAuth /mcp) cannot call owner_decide / owner_consents — unknown_tool, nothing forwarded', async () => {
  const e = await env(); const h = hostFake();
  for (const name of ['owner_decide', 'owner_consents']) {
    const r = await (await handleMcp(new Request(BASE + '/mcp', {method: 'POST', body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: {name, arguments: {consentId: 'a1b2c3d4e5f6', decision: 'allow'}}})}), e, {props: {owner: true}}, {fetcher: h.fetcher})).json();
    assert.equal(r.error.message, 'unknown_tool', name);
  }
  assert.equal(h.calls.length, 0);
});

test('/live/consents and /live/decide: session required; decide needs X-Nexus-Live; strict args; forwards owner_decide', async () => {
  const e = await env(); const h = hostFake(); const c = await makeSession(e);
  assert.equal((await handleDefault(new Request(BASE + '/live/consents'), e, {fetcher: h.fetcher})).status, 401);
  const l = await handleDefault(withCookie('/live/consents', c), e, {fetcher: h.fetcher});
  assert.equal(l.status, 200); assert.deepEqual((await l.json()).pending, PEND);
  const body = JSON.stringify({consentId: 'a1b2c3d4e5f6', decision: 'allow'});
  assert.equal((await handleDefault(new Request(BASE + '/live/decide', {method: 'POST', headers: {'x-nexus-live': '1'}, body}), e, {fetcher: h.fetcher})).status, 401);
  assert.equal((await handleDefault(withCookie('/live/decide', c, {method: 'POST', body}), e, {fetcher: h.fetcher})).status, 403, 'CSRF header');
  for (const bad of ['{', JSON.stringify({consentId: 'x', decision: 'allow'}), JSON.stringify({consentId: 'a1b2c3d4e5f6', decision: 'yes'})])
    assert.ok([400].includes((await handleDefault(withCookie('/live/decide', c, {method: 'POST', headers: {'x-nexus-live': '1'}, body: bad}), e, {fetcher: h.fetcher})).status), bad);
  const ok = await handleDefault(withCookie('/live/decide', c, {method: 'POST', headers: {'x-nexus-live': '1'}, body}), e, {fetcher: h.fetcher});
  assert.equal(ok.status, 200);
  const fwd = h.calls.at(-1);
  assert.equal(fwd.name, 'owner_decide'); assert.deepEqual([fwd.arguments.consentId, fwd.arguments.decision], ['a1b2c3d4e5f6', 'allow']);
  // the decision is signed with the gateway owner key; the Host verifies it with the public key from /owner-pub
  const pub = await (await handleDefault(new Request(BASE + '/owner-pub'), e, {fetcher: h.fetcher})).json();
  assert.equal(pub.alg, 'Ed25519'); assert.match(pub.x, /^[A-Za-z0-9_-]{43}$/);
  const {createPublicKey, verify} = await import('node:crypto');
  const key = createPublicKey({key: {kty: 'OKP', crv: 'Ed25519', x: pub.x}, format: 'jwk'});
  const msg = `nexus-owner-decide-v1|${fwd.arguments.consentId}|${fwd.arguments.decision}|${fwd.arguments.ts}`;
  assert.equal(verify(null, Buffer.from(msg), key, Buffer.from(fwd.arguments.sig, 'base64url')), true);
  assert.equal(verify(null, Buffer.from(msg.replace('allow', 'cancel')), key, Buffer.from(fwd.arguments.sig, 'base64url')), false);
  assert.equal((await (await handleDefault(new Request(BASE + '/owner-pub'), e, {fetcher: h.fetcher})).json()).x, pub.x, 'the key is stable');
  // ⏻ OFF: session + CSRF header → live_control host_off
  assert.equal((await handleDefault(withCookie('/live/off', c, {method: 'POST'}), e, {fetcher: h.fetcher})).status, 403);
  assert.equal((await handleDefault(withCookie('/live/off', c, {method: 'POST', headers: {'x-nexus-live': '1'}}), e, {fetcher: h.fetcher})).status, 200);
  assert.deepEqual(h.calls.at(-1), {name: 'live_control', arguments: {action: 'host_off'}});
  const page = await (await handleDefault(withCookie('/live', c), e, {fetcher: h.fetcher})).text();
  assert.match(page, /id="cq"/); assert.match(page, /\/live\/decide/); assert.match(page, /<title>NEXUS Live View<\/title>/);
});
