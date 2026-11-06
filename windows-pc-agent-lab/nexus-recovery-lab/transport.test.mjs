import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runTransport } from './transport.mjs';

const expected = { status: 'PASS', connectionCount: 2, forcedDrops: 1, committedEffects: 1, retryCount: 1, originalId: 'unchanged', ack: true };

test('real loopback socket drop after commit, reconnect and effect once', { timeout: 10000 }, async () => {
  assert.deepEqual(await runTransport(), expected);
});

test('without reconnect the unknown outcome fails, with one committed effect', { timeout: 10000 }, async () => {
  assert.deepEqual(await runTransport({ reconnect: false }), { ...expected, status: 'FAIL', connectionCount: 1, retryCount: 0, ack: false });
});

test('invalid key fails closed before sending or committing', { timeout: 10000 }, async () => {
  assert.deepEqual(await runTransport({ key: 'INVALID_SYNTHETIC_SECRET_KEY' }), { ...expected, status: 'FAIL', connectionCount: 0, forcedDrops: 0, committedEffects: 0, retryCount: 0, ack: false });
});

test('synthetic secret never appears in report or CLI stdout/stderr', { timeout: 10000 }, async () => {
  const secret = 'SYNTHETIC_PRIVATE_SENTINEL';
  for (const options of [{ syntheticSecret: secret }, { syntheticSecret: secret, reconnect: false }, { syntheticSecret: secret, key: secret }]) {
    const report = await runTransport(options);
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.deepEqual(Object.keys(report), Object.keys(expected));
  }
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./transport.mjs', import.meta.url))], { timeout: 7000, windowsHide: true });
  assert.equal(stderr, '');
  assert.equal(stdout, JSON.stringify(expected) + '\n');
  assert.equal(stdout.includes(secret), false);
});
