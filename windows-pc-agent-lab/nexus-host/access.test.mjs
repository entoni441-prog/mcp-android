import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createAccessVerifier, loadConfig, createServer} from './server.mjs';

const TEAM = 'nexus-test.cloudflareaccess.com';
const AUD = 'a'.repeat(64);
const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
const other = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
const jwk = {...publicKey.export({format: 'jwk'}), kid: 'k1', alg: 'RS256', use: 'sig'};
let jwksCalls = 0;
const fetcher = async (url) => { jwksCalls++; assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`); return {ok: true, json: async () => ({keys: [jwk]})}; };

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(claims, {key = privateKey, kid = 'k1', alg = 'RS256'} = {}) {
  const h = b64({alg, kid, typ: 'JWT'}), p = b64(claims);
  return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), key).toString('base64url')}`;
}
const now = Math.floor(Date.now() / 1000);
const good = {iss: `https://${TEAM}`, aud: [AUD], email: 'Owner@Example.com', exp: now + 600, iat: now};
const verify = createAccessVerifier({teamDomain: TEAM, aud: AUD, allowedEmails: ['owner@example.com']}, {fetcher});

test('valid Access JWT for the owner is accepted', async () => {
  assert.equal(await verify(sign(good)), 'owner@example.com');
});
test('forged, foreign and expired tokens are rejected', async () => {
  assert.equal(await verify(sign(good, {key: other.privateKey})), null, 'wrong key');
  assert.equal(await verify(sign({...good, aud: ['b'.repeat(64)]})), null, 'wrong aud');
  assert.equal(await verify(sign({...good, iss: 'https://evil.cloudflareaccess.com'})), null, 'wrong iss');
  assert.equal(await verify(sign({...good, exp: now - 1})), null, 'expired');
  assert.equal(await verify(sign({...good, email: 'someone@else.com'})), null, 'not owner');
  assert.equal(await verify(sign(good, {alg: 'none'})), null, 'alg none');
  assert.equal(await verify(sign(good, {kid: 'unknown'})), null, 'unknown kid');
  assert.equal(await verify('a.b'), null, 'malformed');
});
test('JWKS is cached, not fetched on every request', async () => {
  const before = jwksCalls;
  await verify(sign(good)); await verify(sign(good));
  assert.equal(jwksCalls, before);
});

test('server accepts Access JWT end-to-end and records principal in audit', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-acc-'));
  const home = path.join(tmp, 'home'); fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, 'access.json'), JSON.stringify({teamDomain: TEAM, aud: AUD, allowedEmails: ['owner@example.com']}));
  const cfg = loadConfig({NEXUS_HOME: home, NEXUS_WORKSPACE: path.join(tmp, 'ws')});
  assert.ok(cfg.access);
  const server = createServer(cfg, {accessVerifier: verify});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const post = (headers) => fetch(url, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'get_status', arguments: {}}})});
  try {
    assert.equal((await post({'cf-access-jwt-assertion': sign(good)})).status, 200);
    assert.equal((await post({'cf-access-jwt-assertion': sign(good, {key: other.privateKey})})).status, 401);
    assert.equal((await post({})).status, 401);
    assert.match(fs.readFileSync(cfg.auditFile, 'utf8'), /"by":"access:owner@example.com"/);
  } finally { server.close(); }
});

test('malformed access.json fails closed at startup', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-bad-'));
  fs.writeFileSync(path.join(home, 'access.json'), JSON.stringify({teamDomain: 'evil.com', aud: 'x', allowedEmails: []}));
  assert.throws(() => loadConfig({NEXUS_HOME: home}), /invalid_access_json/);
});
