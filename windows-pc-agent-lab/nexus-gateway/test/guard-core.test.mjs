import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_FAILS, LOCK_MS, CONSENT_TTL_MS, MAX_PENDING} from '../src/guard-core.mjs';
import {fakeGuardNamespace} from './fake-guard.mjs';

import crypto from 'node:crypto';
const H = s => crypto.createHash('sha256').update(s).digest('hex');
const GOOD = H('owner-pass'), BAD = H('nope');

function mk() { let t = 1_000_000; const g = fakeGuardNamespace(() => t); return {stub: g.ns.get('owner'), advance: ms => { t += ms; }}; }

test('nonce is single-use even under concurrent submissions', async () => {
  const {stub} = mk();
  const nonce = await stub.issue({clientId: 'c'});
  const results = await Promise.all(Array.from({length: 10}, () => stub.attempt({nonce, passphraseSha256: GOOD, approve: true, expectedSha256: GOOD})));
  assert.equal(results.filter(r => r.status === 'ok').length, 1);
  assert.equal(results.filter(r => r.status === 'invalid').length, 9);
});

test('concurrent wrong guesses cannot exceed the limit (no lost updates)', async () => {
  const {stub} = mk();
  const nonces = await Promise.all(Array.from({length: 20}, () => stub.issue({clientId: 'c'})));
  const results = await Promise.all(nonces.map(nonce => stub.attempt({nonce, passphraseSha256: BAD, approve: true, expectedSha256: GOOD})));
  assert.equal(results.filter(r => r.status === 'bad_passphrase').length, MAX_FAILS, 'exactly MAX_FAILS guesses evaluated');
  assert.equal(results.filter(r => r.status === 'locked').length, 20 - MAX_FAILS);
});

test('lockout blocks even the correct passphrase, then expires', async () => {
  const {stub, advance} = mk();
  for (let i = 0; i < MAX_FAILS; i++) await stub.attempt({nonce: await stub.issue({}), passphraseSha256: BAD, approve: true, expectedSha256: GOOD});
  const n = await stub.issue({clientId: 'c'});
  assert.equal((await stub.attempt({nonce: n, passphraseSha256: GOOD, approve: true, expectedSha256: GOOD})).status, 'locked');
  advance(LOCK_MS + 1);
  assert.equal((await stub.attempt({nonce: n, passphraseSha256: GOOD, approve: true, expectedSha256: GOOD})).status, 'invalid', 'nonce outlived its 5-min TTL during the 15-min lock');
});

test('success resets the counter; deny burns the nonce without counting', async () => {
  const {stub} = mk();
  for (let i = 0; i < MAX_FAILS - 1; i++) await stub.attempt({nonce: await stub.issue({}), passphraseSha256: BAD, approve: true, expectedSha256: GOOD});
  assert.equal((await stub.attempt({nonce: await stub.issue({x: 1}), passphraseSha256: GOOD, approve: true, expectedSha256: GOOD})).status, 'ok');
  for (let i = 0; i < MAX_FAILS - 1; i++) assert.equal((await stub.attempt({nonce: await stub.issue({}), passphraseSha256: BAD, approve: true, expectedSha256: GOOD})).status, 'bad_passphrase');
  const n = await stub.issue({});
  assert.equal((await stub.attempt({nonce: n, approve: false, expectedSha256: GOOD})).status, 'denied');
  assert.equal((await stub.attempt({nonce: n, passphraseSha256: GOOD, approve: true, expectedSha256: GOOD})).status, 'invalid');
});

test('consent expires after TTL; pending set is bounded', async () => {
  const {stub, advance} = mk();
  const n = await stub.issue({});
  advance(CONSENT_TTL_MS + 1);
  assert.equal((await stub.attempt({nonce: n, passphraseSha256: GOOD, approve: true, expectedSha256: GOOD})).status, 'invalid');
  const first = await stub.issue({});
  for (let i = 0; i < MAX_PENDING; i++) { advance(1); await stub.issue({}); }
  assert.equal((await stub.attempt({nonce: first, passphraseSha256: GOOD, approve: true, expectedSha256: GOOD})).status, 'invalid', 'oldest evicted');
});
