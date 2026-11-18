import test from 'node:test';
import assert from 'node:assert/strict';
import {createPower, isHibernateAvailable} from './power.mjs';
import {OWNER_WHATS, createConsent} from './consent.mjs';

const ruAvailable = [
  'В данной системе доступны следующие состояния спящего режима:',
  '    Ждущий режим (S3)',
  '    Гибернация',
  '    Гибридный спящий режим',
  'Следующие состояния спящего режима недоступны в данной системе:',
  '    Ждущий режим (S1)',
];
const ruUnavailable = [
  'В данной системе доступны следующие состояния спящего режима:',
  '    Ждущий режим (S3)',
  'Следующие состояния спящего режима недоступны в данной системе:',
  '    Гибернация',
];

function scenario(facts = {}, overrides = {}) {
  const executed = [];
  const grants = [];
  const defaults = {autostartVerified: true, logonChannelVerified: false,
    wakeDevice: null, unsavedOwnerDocs: [], sleepStates: ruAvailable};
  const consent = {requestGrant(entry) {
    grants.push(entry);
    return {status: 'consent_required', what: entry.what, target: entry.target};
  }};
  const power = createPower({caps: {power: true}, platform: 'win32',
    facts: async () => ({...defaults, ...facts}),
    consent, exec: async (exe, args) => { executed.push({exe, args}); return {code: 0}; },
    ...overrides});
  return {power, executed, grants};
}

test('Russian and English available hibernation are recognized, unavailable modes are not', () => {
  assert.equal(isHibernateAvailable(ruAvailable), true);
  assert.equal(isHibernateAvailable(ruUnavailable), false);
  assert.equal(isHibernateAvailable(['The following sleep states are available on this system:',
    '    Hibernate', 'The following sleep states are not available on this system:', '    Standby (S1)']), true);
  assert.equal(isHibernateAvailable(['The following sleep states are available on this system:',
    '    Standby (S3)', 'The following sleep states are not available on this system:', '    Hibernate']), false);
  assert.equal(isHibernateAvailable([]), false);
});

test('sleep without wake returns MANUAL recovery plan, not a misleading independent wake blocker', async () => {
  const s = scenario();
  const plan = await s.power.power_action({action: 'sleep'});
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.recovery.mode, 'manual_owner_approval');
  assert.equal(plan.recovery.independentWakeConfirmed, false);
  assert.equal(plan.recovery.requiresSignedOwnerApproval, true);
  assert.match(plan.warning, /NEXUS will disconnect/);
  assert.equal(s.executed.length, 0);
});

test('manual sleep never runs without one-time owner consent', async () => {
  const s = scenario();
  const r = await s.power.power_action({action: 'sleep', dryRun: false});
  assert.equal(r.status, 'consent_required');
  assert.equal(r.what, 'system_power');
  assert.match(r.target, /ВРУЧНУЮ/);
  assert.equal(s.executed.length, 0);
});

test('the manual-recovery consent is truly in the signed owner approval tier', async () => {
  assert.equal(OWNER_WHATS.has('system_power'), true);
  const consent = createConsent({autonomy: true});
  const out = await consent.requestGrant({what: 'system_power', target: 'manual shutdown mock',
    apply: () => { throw Error('must_not_run_without_owner'); }});
  assert.equal(out.status, 'consent_required');
  assert.equal(out.approval, 'owner_phone');
  assert.equal(out.expiresInSec, 600);
  assert.equal(consent.pendingCount(), 1);
});

test('simulated approved manual sleep uses exact harmless fake exec once', async () => {
  const s = scenario();
  await s.power.power_action({action: 'sleep', dryRun: false});
  const executed = await s.grants[0].apply();
  assert.equal(executed.accepted, true);
  assert.equal(s.executed.length, 1);
  assert.match(s.executed[0].args.at(-1), /SetSuspendState\('Suspend'/);
});

test('unsaved owner documents still block manual sleep and shutdown BEFORE consent', async () => {
  const s = scenario({unsavedOwnerDocs: ['notepad']});
  for (const action of ['sleep', 'shutdown']) {
    const out = await s.power.power_action({action, dryRun: false});
    assert.equal(out.status, 'BLOCKED');
    assert.ok(out.blockers.includes('noUnsavedOwnerDocuments'));
  }
  assert.equal(s.grants.length, 0);
  assert.equal(s.executed.length, 0);
});

test('hibernate on Russian Windows passes support check and remains signed-owner gated', async () => {
  const s = scenario();
  const plan = await s.power.power_action({action: 'hibernate'});
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.preconditions.hibernateSupported, true);
  const r = await s.power.power_action({action: 'hibernate', dryRun: false});
  assert.equal(r.what, 'system_power');
  assert.equal(s.executed.length, 0);
});

test('unavailable hibernate is still hard blocked even with manual restoration', async () => {
  const s = scenario({sleepStates: ruUnavailable});
  const r = await s.power.power_action({action: 'hibernate', dryRun: false});
  assert.equal(r.status, 'BLOCKED');
  assert.ok(r.blockers.includes('hibernateSupported'));
  assert.equal(s.grants.length, 0);
});

test('shutdown with owner physical restoration is gated; no shutdown is issued by dry run', async () => {
  const s = scenario();
  const r = await s.power.power_action({action: 'shutdown', dryRun: false});
  assert.equal(r.what, 'system_power');
  assert.match(r.target, /через 60 с/);
  assert.equal(s.executed.length, 0);
});

test('restart with missing logon verification uses the signed owner recovery tier', async () => {
  const s = scenario({wakeDevice: 'confirmed-LAN-device'});
  const p = await s.power.power_action({action: 'restart'});
  assert.equal(p.recovery.mode, 'manual_owner_approval');
  assert.deepEqual(p.blockers, []);
  assert.equal((await s.power.power_action({action:'restart',dryRun:false})).what, 'system_power');
});

test('with verified remote wake and logon normal power policy remains unchanged', async () => {
  const s = scenario({wakeDevice: 'verified-LAN-wake', logonChannelVerified: true});
  const p = await s.power.power_action({action: 'shutdown'});
  assert.equal(p.recovery.mode, 'remote');
  assert.equal(p.preconditions.independentWakeDevice, true);
  assert.equal(p.preconditions.logonChannelVerified, true);
  const r = await s.power.power_action({action: 'shutdown', dryRun: false});
  assert.equal(r.what, 'system_power');
});

test('power_off and wake still require independent hardware and are never proxied from the sleeping host', async () => {
  const s = scenario();
  for (const action of ['wake', 'power_on']) {
    const r = await s.power.power_action({action, dryRun: false});
    assert.equal(r.status, 'BLOCKED');
    assert.equal(r.reason, 'no_independent_wake_device');
  }
  assert.equal(s.grants.length, 0);
  assert.equal(s.executed.length, 0);
});

test('no automatic power operation when capability is disabled', async () => {
  const s = scenario({}, {caps: {power: false}});
  await assert.rejects(() => s.power.power_action({action:'sleep',dryRun:false}), /capability|disabled|power/i);
  assert.equal(s.executed.length, 0);
});
