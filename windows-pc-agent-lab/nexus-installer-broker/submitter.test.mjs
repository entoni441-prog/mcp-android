import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createSignedTestApproval} from './contract.mjs';
import {createSubmitter,INBOX} from './submitter.mjs';
import {BROKER_TASK_NAME} from './task-xml.mjs';

const t=1794145000000;
const signers={chat:crypto.generateKeyPairSync('ed25519'),
  live:crypto.generateKeyPairSync('ed25519')};
const publicKeys={
  chat:{'test-chat':signers.chat.publicKey},
  live:{'test-live':signers.live.publicKey}
};
let serial=0;
function approval(channel){
  return createSignedTestApproval({channel,privateKey:signers[channel].privateKey,
    requestId:(++serial).toString(16).padStart(32,'0'),keyId:'test-'+channel,now:t});
}
function setup({exists=false,exit=0}={}){
  const events=[];
  const fsImpl={writeFileSync(p,v,opts){
    if(exists){const e=new Error('exists');e.code='EEXIST';throw e;}
    events.push({type:'write',p,v,opts});
  }};
  const spawn=(exe,args,options)=>{events.push({type:'spawn',exe,args,options});return {status:exit};};
  return {events,submitter:createSubmitter({publicKeys,now:()=>t,fsImpl,spawn})};
}
test('chat mode independently writes signed approval and triggers exact OS task',()=>{
  const t=setup(),g=approval('chat');
  assert.deepEqual(t.submitter.submit(g),{status:'triggered_unverified',requestId:g.payload.requestId});
  assert.equal(t.events.length,2);
  assert.equal(t.events[0].p,INBOX+'\\current.json');
  assert.equal(t.events[0].opts.flag,'wx');
  assert.deepEqual(t.events[1].args,['/Run','/TN',BROKER_TASK_NAME]);
  assert.equal(t.events[1].exe,'C:\\Windows\\System32\\schtasks.exe');
});
test('Live mode has no dependency on chat',()=>{
  const t=setup(),g=approval('live');
  assert.equal(t.submitter.submit(g).status,'triggered_unverified');
  assert.equal(t.events.length,2);
});
test('unsigned/modified approval cannot start elevated task',()=>{
  const t=setup(),g=approval('live');
  const forged={...g,signature:'A'.repeat(86)};
  assert.throws(()=>t.submitter.submit(forged),/approval_signature_invalid/);
  assert.equal(t.events.length,0);
});
test('model-supplied arbitrary install commands never become an authorization',()=>{
  const t=setup(),g=approval('chat');
  g.payload.args=['/i','C:\\Temp\\other.msi'];
  assert.throws(()=>t.submitter.submit(g),/approval_schema_invalid/);
  assert.equal(t.events.length,0);
});
test('pending previous request is not overwritten or re-run',()=>{
  const t=setup({exists:true});
  assert.throws(()=>t.submitter.submit(approval('chat')),
    /existing_request_requires_manual_reconciliation/);
  assert.equal(t.events.length,0);
});
test('Task Scheduler launch unknown does not auto-retry privileged work',()=>{
  const t=setup({exit:1}),g=approval('live');
  assert.deepEqual(t.submitter.submit(g),{status:'queued_not_started',requestId:g.payload.requestId});
  assert.equal(t.events.filter(e=>e.type==='spawn').length,1);
});
