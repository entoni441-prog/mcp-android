import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {ALLOWED_INSTALLS,verifyApproval,approvalMessage,createSignedTestApproval,
  MAX_AGE_MS} from './contract.mjs';
import {createInstallerBroker,fixedInstallCommand,SECURE_STAGE,MSIEXE} from './broker.mjs';
import {createMemoryJournal} from './journal.mjs';
import path from 'node:path';

const t=1781441400000;
const chat=crypto.generateKeyPairSync('ed25519');
const live=crypto.generateKeyPairSync('ed25519');
const keys={chat:{'test-chat':chat.publicKey},live:{'test-live':live.publicKey}};
const pkg=ALLOWED_INSTALLS['chrome-remote-desktop-host-157'];
const artifact={kind:'msi',sha256:pkg.sha256,bytes:pkg.bytes,
  signatureValid:true,publisher:pkg.publisher};
const staged=path.win32.join(SECURE_STAGE,pkg.sha256+'.msi');
let next=0;
const id=()=> (++next).toString(16).padStart(32,'0');
const permit=(channel='chat',extra={})=>createSignedTestApproval({
  privateKey:channel==='chat'?chat.privateKey:live.privateKey,
  channel,requestId:id(),now:t,...extra
});
const make=(options={})=>{
  const journal=createMemoryJournal(),calls=[],audit=[];
  let count=0;
  const io={
    readVerifiedSource:async()=>({...artifact,...options.source}),
    copyToProtectedStage:async()=>({path:options.stagePath??staged}),
    readVerifiedStage:async p=>({...artifact,path:p,...options.staged}),
    runFixedInstaller:async cmd=>{count++;calls.push(cmd);
      if(options.throwAfterStart)throw Error('simulated unknown outcome');
      return {exitCode:options.exitCode??0};
    },
    verifyInstalled:async()=>options.verifyInstalled??true
  };
  return {broker:createInstallerBroker({keys,now:()=>t,journal,io,
      audit:e=>audit.push(e),privilegedReady:()=>options.elevated??true,
      stopRequested:()=>options.stopped??false}),calls,journal,audit,
    count:()=>count};
};
test('A: chat-owner signed approval independently installs exact allowlisted package',async()=>{
  const s=make(),grant=permit('chat');
  const result=await s.broker.install(grant);
  assert.equal(result.status,'installed_verified');
  assert.equal(s.calls.length,1);
  assert.deepEqual(s.calls[0],{exe:MSIEXE,args:['/i',staged,'/qn','/norestart']});
  assert.equal(s.journal.inspect(grant.payload.requestId).state,'installed_verified');
  assert.equal(s.audit[0].channel,'chat');
});
test('B: Live-owner approval independently installs without chat signature',async()=>{
  const s=make(),grant=permit('live');
  assert.equal((await s.broker.install(grant)).status,'installed_verified');
  assert.equal(s.audit[0].channel,'live');
});
test('two channel trust roots are never interchangeable',()=>{
  const grant=permit('chat');
  const forged={...grant,payload:{...grant.payload,channel:'live'}};
  assert.throws(()=>verifyApproval(forged,{publicKeys:keys,now:t}),/channel_trust_root_missing/);
  const overlap={chat:keys.chat,live:{'test-chat':live.publicKey}};
  assert.throws(()=>verifyApproval(forged,{publicKeys:overlap,now:t}),/approval_signature_invalid/);
  const noChat={live:keys.live};
  assert.throws(()=>verifyApproval(grant,{publicKeys:noChat,now:t}),/channel_trust_root_missing/);
});
test('signature binds package digest, exact schema and timestamp',()=>{
  const g=permit('live');
  assert.throws(()=>verifyApproval({...g,payload:{...g.payload,artifactSha256:'0'.repeat(64)}},{publicKeys:keys,now:t}),
    /package_digest_not_allowlisted/);
  assert.throws(()=>verifyApproval({...g,payload:{...g.payload,issuedAt:g.payload.issuedAt+5}},{publicKeys:keys,now:t}),
    /approval_signature_invalid/);
  assert.throws(()=>verifyApproval({...g,payload:{...g.payload,extra:'sudo'}},{publicKeys:keys,now:t}),
    /approval_schema_invalid/);
  assert.throws(()=>verifyApproval({...g,payload:{...g.payload,packageId:'random.msi'}},{publicKeys:keys,now:t}),
    /approval_fields_invalid/);
  assert.ok(approvalMessage(g.payload).length>50);
});
test('expired or future approvals always fail closed',()=>{
  const g=permit('chat');
  assert.throws(()=>verifyApproval(g,{publicKeys:keys,now:t+MAX_AGE_MS}),/approval_expired_or_invalid_time/);
  assert.throws(()=>verifyApproval(g,{publicKeys:keys,now:t-60000}),/approval_expired_or_invalid_time/);
});
test('same signed approval cannot cause repeated installation',async()=>{
  const s=make(),g=permit('live');
  assert.equal((await s.broker.install(g)).status,'installed_verified');
  await assert.rejects(s.broker.install(g),/approval_replay_refused/);
  assert.equal(s.count(),1);
});
test('unknown outcome is durable; never repeat installer',async()=>{
  const s=make({throwAfterStart:true}),g=permit('chat');
  assert.equal((await s.broker.install(g)).status,'outcome_unknown');
  assert.equal(s.journal.inspect(g.payload.requestId).state,'outcome_unknown');
  await assert.rejects(s.broker.install(g),/approval_replay_refused/);
  assert.equal(s.count(),1);
});
test('privileged broker refuses start until OS has provisioned trusted boundary',async()=>{
  const s=make({elevated:false});
  await assert.rejects(s.broker.install(permit()),/broker_not_privileged_or_provisioned/);
  assert.equal(s.count(),0);
});
test('STOP refuses before any shell effect',async()=>{
  const s=make({stopped:true});
  await assert.rejects(s.broker.install(permit()),/broker_stopped/);
  assert.equal(s.count(),0);
});
test('source signer, byte size, digest and protected staging cannot be bypassed',async()=>{
  for(const options of [
    {source:{signatureValid:false}},{source:{bytes:8}},
    {source:{sha256:'1'.repeat(64)}},{source:{publisher:'Unknown Co'}},
    {stagePath:'C:\\Users\\krado\\Downloads\\google.msi'},
    {staged:{sha256:'1'.repeat(64)}},{staged:{signatureValid:false}}
  ]){
    const s=make(options);
    await assert.rejects(s.broker.install(permit()),/untrusted_(?:source_package|stage_location)|staged_content_or_signer_changed/);
    assert.equal(s.count(),0);
  }
});
test('no arbitrary EXE, arguments or untrusted stage path',()=>{
  assert.throws(()=>fixedInstallCommand('C:\\Temp\\google.msi',pkg.sha256),/untrusted_staged_path/);
  assert.throws(()=>fixedInstallCommand(staged,'0'.repeat(64)),/untrusted_staged_path/);
});
test('even a failed MSI exit is journaled and never automatically re-run',async()=>{
  const s=make({exitCode:1603}),g=permit('chat');
  assert.equal((await s.broker.install(g)).status,'install_result_unverified');
  assert.equal(s.journal.inspect(g.payload.requestId).exitCode,1603);
  await assert.rejects(s.broker.install(g),/approval_replay_refused/);
});
test('installed service post-check is mandatory for PASS',async()=>{
  const s=make({verifyInstalled:false});
  assert.equal((await s.broker.install(permit())).status,'installed_not_verified');
});
