import test from 'node:test';
import assert from 'node:assert/strict';
import {createConsent} from './consent.mjs';
import {diagnostics} from './server.mjs';

const cfg = consent => ({
  runtime: {
    consent,
    store: {status: () => ({fileError: null})},
    live: {status: () => ({state: 'ready'})},
  },
});

test('replayed read-only SSH command is chat-only, not a pending /live owner approval', () => {
  let now = 500000, executions = 0;
  const consent = createConsent({
    autonomy: true, now: () => now,
    journal: {
      keyFor: () => 'external-operation-key',
      alreadyDone: () => ({at: '2026-11-18T06:48:19Z', task: 'prior-execution'}),
    },
  });
  const req = consent.requestGrant({
    what: 'arbitrary_command',
    target: 'read-only status on guest network',
    apply: () => {executions += 1; return {ok: true};},
  });
  assert.equal(req.status, 'consent_required');
  assert.match(req.target, /^ПОВТОР/);
  assert.equal(req.approval, undefined);
  assert.equal(req.expiresInSec, 120);
  assert.equal(consent.ownerList().length, 0);
  assert.equal(executions, 0);
  const before = diagnostics(cfg(consent));
  assert.equal(before.pendingConsents, 1);
  assert.equal(before.pendingChatConsents, 1);
  assert.equal(before.awaitingOwnerApprovals, 0);
  assert.equal(before.approvedAwaitingExecution, 0);
  now += 120001;
  const after = diagnostics(cfg(consent));
  assert.equal(after.pendingConsents, 0);
  assert.equal(after.pendingChatConsents, 0);
});

test('owner-tier consent stays on /live queue and is excluded from chat-only count', () => {
  const consent = createConsent({autonomy: true});
  const req = consent.requestGrant({
    what: 'protected_file',
    target: 'protected resource read',
    apply: () => ({ok: true}),
  });
  assert.equal(req.approval, 'owner_phone');
  const data = diagnostics(cfg(consent));
  assert.equal(data.pendingConsents, 1);
  assert.equal(data.pendingChatConsents, 0);
  assert.equal(data.awaitingOwnerApprovals, 1);
  assert.equal(consent.ownerList().length, 1);
});
