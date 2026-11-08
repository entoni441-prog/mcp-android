import test from 'node:test';
import assert from 'node:assert/strict';
import {createConsent} from './consent.mjs';
import {classifyDestructiveClick} from './policy.mjs';

test('owner approved, but not yet executed: UI shows decided=allow, Host count remains active', async () => {
  let now=1000000, launches=0;
  const c=createConsent({autonomy:true, now:()=>now});
  const req=c.requestGrant({what:'destructive_action',target:'Delete test item',
    apply:async()=>{launches++;return {done:true};}});
  assert.equal(req.status,'consent_required');
  assert.equal(req.approval,'owner_phone');
  assert.equal(c.ownerList()[0].decided,null);
  assert.equal(c.pendingCount(),1);
  await assert.rejects(async()=>c.take(req.consentId,'allow',req.target),/owner_approval_pending/);
  c.ownerDecide(req.consentId,'allow');
  assert.equal(c.ownerList()[0].decided,'allow');
  assert.equal(c.pendingCount(),1,'approved request still awaits execution');
  assert.equal(launches,0,'owner decision alone must not invoke privileged/user GUI action');
  const consumed=c.take(req.consentId,'allow',req.target);
  assert.deepEqual(await consumed.apply(),{done:true});
  assert.equal(launches,1);
  assert.equal(c.pendingCount(),0);
  assert.deepEqual(c.ownerList(),[]);
});

test('denied and expired approvals cannot execute or inflate Host diagnostics', () => {
  let clock=0, launches=0;
  const c=createConsent({autonomy:true,now:()=>clock});
  const req=c.requestGrant({what:'destructive_action',target:'delete document',
    apply:()=>{launches++;return {};}});
  c.ownerDecide(req.consentId,'cancel');
  assert.equal(c.ownerList()[0].decided,'cancel');
  assert.equal(c.take(req.consentId,'allow',req.target).cancelledByOwner,true);
  assert.equal(launches,0);
  const second=c.requestGrant({what:'destructive_action',target:'delete another document',apply:()=>{launches++;}});
  assert.equal(c.pendingCount(),1);
  clock+=600001;
  assert.equal(c.pendingCount(),0,'stale map entries are pruned before diagnostics');
  assert.deepEqual(c.ownerList(),[]);
  assert.throws(()=>c.take(second.consentId,'allow',second.target),/consent_expired_or_unknown/);
  assert.equal(launches,0);
});

test('Russian remote desktop noun is not an erasure verb; actual removal still needs consent',()=>{
  const el=name=>({elem:{controlType:'Button',name},process:'msedge'});
  for(const name of ['Скачать Удаленный рабочий стол Chrome','Скачать Удалённый рабочий стол Chrome'])
    assert.equal(classifyDestructiveClick(el(name)),null,name);
  for(const name of ['Удалить Удалённый рабочий стол Chrome','Удаление удалённых подключений'])
    assert.equal(classifyDestructiveClick(el(name)).what,'destructive_action',name);
});
