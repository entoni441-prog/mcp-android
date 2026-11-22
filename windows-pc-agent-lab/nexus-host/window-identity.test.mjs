import test from 'node:test';
import assert from 'node:assert/strict';
import {windowIdentity, sameWindowIdentity} from './window-identity.mjs';
import {createConsent} from './consent.mjs';

const w = (hwnd = 12, pid = 41, process = 'Notepad', tabs = []) =>
  ({hwnd, pid, process, name: 'test window', tabs});

test('identity requires valid HWND, PID, process', () => {
  assert.deepEqual(windowIdentity(w()), {hwnd: '12', pid: 41, process: 'notepad'});
  for (const bad of [null, {}, w(0), w(12, 0), w(12, 41, ''), w(NaN), w(12, -1)])
    assert.equal(windowIdentity(bad), null);
});
test('reused handle, changed PID or process, missing identity fail closed', () => {
  const id = windowIdentity(w());
  assert.equal(sameWindowIdentity(id, w(12, 41, 'NOTEPAD.exe')), true);
  for (const changed of [w(12, 42), w(12, 41, 'Explorer'), w(13), {hwnd: 12}, null])
    assert.equal(sameWindowIdentity(id, changed), false);
});
test('existing consent registry does not authorize reused HWND', () => {
  const c = createConsent();
  c.recordCreated([], [w()], 'test');
  assert.equal(c.ownsWindow(w()), true);
  assert.equal(c.isOwned({kind: 'window'}, w(), null), true);
  assert.equal(c.isOwned({kind: 'window'}, w(12, 42), null), false);
  const denied = c.gate({kind: 'window', via: 'test'}, w(12, 42), null, {});
  assert.equal(denied.status, 'consent_required');
});
test('pruning forgets mismatched identity and scratch privilege', () => {
  const c = createConsent();
  const original = {...w(), name: 'NEXUS-unique'};
  c.recordCreated([], [original], 'test', {token: 'NEXUS-unique'});
  assert.equal(c.owned.scratch.has('12'), true);
  c.prune([w(12, 42)]);
  assert.equal(c.owned.windows.has('12'), false);
  assert.equal(c.owned.scratch.has('12'), false);
  assert.equal(c.ownsWindow(original), false);
});
test('owner tabs and missing identity prevent autonomous window close', () => {
  const c = createConsent();
  c.recordCreated([], [w()], 'test');
  assert.equal(c.isOwned({kind: 'window'}, w(12, 41, 'Notepad', [{rid: 'owner'}]), null), false);
  assert.equal(c.ownsWindow({hwnd: 12}), false);
  const invalid = createConsent();
  assert.deepEqual(invalid.recordCreated([], [{hwnd: 12, name: 'unknown'}], 'test').windows, []);
  assert.equal(invalid.owned.windows.size, 0);
});
test('forget removes the registered identity', () => {
  const c = createConsent();
  c.recordCreated([], [w()], 'test');
  c.forget(w());
  assert.equal(c.ownsWindow(w()), false);
});
