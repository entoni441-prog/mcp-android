// Specific integration coverage for the CURRENTLY RUNNING Documents\NEXUS variant.
// The older Git baseline lacks onBeforeRestart and signed system_power by design.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPower, isHibernateAvailable} from './power.mjs';
import {createConsent, OWNER_WHATS} from './consent.mjs';

const ruPower = [
  'В данной системе доступны следующие состояния спящего режима:',
  '    Ждущий режим (S3)',
  '    Гибернация',
  'Следующие состояния спящего режима недоступны в данной системе:',
  '    Ждущий режим (S1)',
];
const facts = {autostartVerified: true, logonChannelVerified: false, wakeDevice: null,
  sleepStates: ruPower, unsavedOwnerDocs: []};

test('live signing policy already protects system_power and logon attestation', () => {
  assert.equal(OWNER_WHATS.has('system_power'), true);
  assert.equal(OWNER_WHATS.has('logon_channel_attestation'), true);
});

test('live code: manual owner recovery is presented without issuing any real power command', async () => {
  let actions=0;
  const consent=createConsent({autonomy:true});
  const p=createPower({caps:{power:true},consent,platform:'win32',facts:async()=>facts,
    exec: async()=>{actions++;return {code:0};}});
  for(const action of ['sleep','hibernate','shutdown']){
    const plan=await p.power_action({action});
    assert.deepEqual(plan.blockers,[]);
    assert.equal(plan.recovery.mode,'manual_owner_approval');
    const pending=await p.power_action({action,dryRun:false});
    assert.equal(pending.status,'consent_required');
    assert.equal(pending.approval,'owner_phone');
    assert.match(pending.target,/ВРУЧНУЮ/);
  }
  assert.equal(actions,0);
});

test('restart with absent pre-logon attestation remains gated, and callback is preserved', async () => {
  let grant, attestationConsumed=0, actions=0, method='';
  const p=createPower({caps:{power:true}, platform:'win32', facts:async()=>facts,
    consent:{requestGrant:req=>{grant=req;return {status:'consent_required',what:req.what};}},
    onBeforeRestart:()=>{attestationConsumed++;},
    exec:async(exe,args)=>{actions++;method=args[0];assert.equal(attestationConsumed,1);return {code:0};}});
  const x=await p.power_action({action:'restart',dryRun:false});
  assert.equal(x.status,'consent_required');
  assert.equal(grant.what,'system_power');
  assert.equal(actions,0);
  assert.equal(attestationConsumed,0);
  const applied=await grant.apply();
  assert.equal(applied.accepted,true);
  assert.equal(actions,1);
  assert.equal(attestationConsumed,1);
  assert.equal(method,'/r');
});

test('Russian Windows hibernation recognized in AVAILABLE section only', () => {
  assert.equal(isHibernateAvailable(ruPower),true);
  assert.equal(isHibernateAvailable(['Доступны:','Ждущий режим (S3)',
    'Следующие состояния спящего режима недоступны в данной системе:', '    Гибернация']),false);
});

test('unsaved owner documents hard block before signed approval', async () => {
  let grants=0;
  const p=createPower({caps:{power:true},platform:'win32',
    facts:async()=>({...facts,unsavedOwnerDocs:['editor']}),
    consent:{requestGrant:()=>{grants++;return {};}},
    exec:()=>{throw Error('must_not_execute');}});
  const out=await p.power_action({action:'sleep',dryRun:false});
  assert.equal(out.status,'BLOCKED');
  assert.ok(out.blockers.includes('noUnsavedOwnerDocuments'));
  assert.equal(grants,0);
});
