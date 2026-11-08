import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createLogonAttestation,assessLogonReadiness,CRD_OWNER_WHAT} from './logon-attestation.mjs';
import {createConsent,OWNER_WHATS} from './consent.mjs';
import {createCapStore,SETTABLE} from './capstore.mjs';
import {loadCapabilities} from './capabilities.mjs';
import {createPower} from './power.mjs';

const goodService=()=>({data:[{Name:'chromoting',State:'Running',StartMode:'Auto',StartName:'LocalSystem'}]});
const goodTask=()=>({data:{tasks:[{name:'NEXUS-Host-Logon',state:'Ready',triggers:['MSFT_TaskLogonTrigger']}]}});
function rig(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-crd-owner-'));
  const {file,caps}=loadCapabilities(dir);
  const audit=[];
  const store=createCapStore({file,initial:caps,audit:x=>audit.push(x)});
  const consent=createConsent({autonomy:true,audit:x=>audit.push(x)});
  let service=goodService(),task=goodTask();
  const diag={system_info:async({topic})=>topic==='services'?service:topic==='autostart_nexus'?task:undefined};
  const channel=createLogonAttestation({store,consent,diag,audit:x=>audit.push(x)});
  return {dir,file,store,consent,channel,audit,
    breakService:()=>{service={data:[{...goodService().data[0],State:'Stopped'}]};},
    breakTask:()=>{task={data:{tasks:[]}};},
    restore:()=>{service=goodService();task=goodTask();}};
}
function approved(r,decision='allow'){
  assert.equal(r.status,'consent_required');
  assert.equal(r.approval,'owner_phone');
  assert.equal(r.what,CRD_OWNER_WHAT);
  return r;
}
test('readiness needs running Auto LocalSystem Chrome service AND active NEXUS logon task',()=>{
  assert.equal(assessLogonReadiness({services:goodService(),autostart:goodTask()}).ready,true);
  for(const bad of [
    {services:null,autostart:goodTask()},
    {services:{data:[{...goodService().data[0],State:'Stopped'}]},autostart:goodTask()},
    {services:{data:[{...goodService().data[0],StartMode:'Manual'}]},autostart:goodTask()},
    {services:{data:[{...goodService().data[0],StartName:'krado'}]},autostart:goodTask()},
    {services:goodService(),autostart:{data:{tasks:[]}}},
    {services:goodService(),autostart:{data:{tasks:[{...goodTask().data.tasks[0],state:'Disabled'}]}}},
  ])assert.equal(assessLogonReadiness(bad).ready,false);
});

test('attestation is NOT a chat-toggle: guarded owner request and one signed-owner lifecycle',async()=>{
  const h=rig();
  assert.equal(OWNER_WHATS.has('logon_channel_attestation'),true);
  assert.equal(SETTABLE.includes('logonChannelVerified'),false);
  assert.throws(()=>h.store.set('logonChannelVerified',true),/invalid_args/);
  const st=await h.channel.logon_attestation({action:'status'});
  assert.equal(st.ready,true); assert.equal(st.verified,false);
  const req=approved(await h.channel.logon_attestation({action:'request'}));
  assert.match(req.target,/ЛИЧНО проверил/);
  assert.equal(h.store.view.logonChannelVerified,false);
  assert.deepEqual(h.consent.ownerList().map(x=>x.consentId),[req.consentId]);
  assert.throws(()=>h.consent.take(req.consentId,'allow',req.target),/owner_approval_pending/);
  assert.equal(h.store.view.logonChannelVerified,false);
  h.consent.ownerDecide(req.consentId,'allow'); // tests model owner's signed channel; server verifies Ed25519
  const p=h.consent.take(req.consentId,'allow',req.target);
  assert.equal((await p.apply()).verified,true);
  assert.equal(h.store.view.logonChannelVerified,true);
  const saved=JSON.parse(fs.readFileSync(h.file,'utf8'));
  assert.equal(saved.logonChannelVerified,true);
  assert.equal(saved._logonChannelAttestation.by,'signed_owner_live');
  assert.equal(saved._logonChannelAttestation.postRebootTested,false);
  assert.equal((await h.channel.logon_attestation({action:'status'})).verified,true);
  assert.equal(h.consent.ownerList().length,0);
  assert.ok(h.audit.some(e=>e.event==='logon_attestation_confirmed'));
});

test('revoked or unavailable service fails closed; approval rechecks at execution',async()=>{
  const h=rig();
  h.breakService();
  let s=await h.channel.logon_attestation({action:'request'});
  assert.equal(s.status,'BLOCKED');assert.equal(h.consent.ownerList().length,0);
  h.restore();
  const req=approved(await h.channel.logon_attestation({action:'request'}));
  h.consent.ownerDecide(req.consentId,'allow');
  h.breakTask();
  const p=h.consent.take(req.consentId,'allow',req.target);
  assert.equal((await p.apply()).status,'BLOCKED');
  assert.equal(h.store.view.logonChannelVerified,false);
  h.restore();
  const req2=approved(await h.channel.logon_attestation({action:'request'}));
  h.consent.ownerDecide(req2.consentId,'allow');
  await h.consent.take(req2.consentId,'allow',req2.target).apply();
  h.breakService();
  const status=await h.channel.logon_attestation({action:'status'});
  assert.equal(status.ownerAttested,true);
  assert.equal(status.verified,false);
  assert.equal((await h.channel.logon_attestation({action:'revoke'})).revoked,true);
  assert.equal(h.store.view.logonChannelVerified,false);
  const doc=JSON.parse(fs.readFileSync(h.file,'utf8'));
  assert.equal(doc._logonChannelAttestation,null);
});

test('single reboot trial has TWO different owner approvals; attestation consumed before shutdown.exe runs',async()=>{
  const h=rig(); let commands=[];
  const power=createPower({caps:h.store.view,consent:h.consent,platform:'win32',
    facts:async()=>({autostartVerified:true,logonChannelVerified:h.store.view.logonChannelVerified && (await h.channel.probe()).ready,unsavedOwnerDocs:[],wakeDevice:null}),
    exec:async(exe,args)=>{commands.push({exe,args,flagWhenCalled:h.store.view.logonChannelVerified});return {code:0};},
    onBeforeRestart:()=>h.store.recordLogonAttestation(false,'restart_gate_consumed')});
  const blocked=await power.power_action({action:'restart',dryRun:false});
  assert.equal(blocked.status,'BLOCKED');
  assert.equal(commands.length,0);
  const att=approved(await h.channel.logon_attestation({action:'request'}));
  h.consent.ownerDecide(att.consentId,'allow');
  await h.consent.take(att.consentId,'allow',att.target).apply();
  assert.equal(h.store.view.logonChannelVerified,true);
  const restart=await power.power_action({action:'restart',dryRun:false});
  assert.equal(restart.status,'consent_required');
  assert.equal(restart.what,'system_power');
  assert.equal(restart.approval,'owner_phone');
  assert.equal(commands.length,0);
  assert.throws(()=>h.consent.take(restart.consentId,'allow',restart.target),/owner_approval_pending/);
  h.consent.ownerDecide(restart.consentId,'allow');
  const p=h.consent.take(restart.consentId,'allow',restart.target);
  const result=await p.apply();
  assert.equal(result.accepted,true);
  assert.equal(h.store.view.logonChannelVerified,false,'consumed before Windows accepts restart');
  assert.equal(commands.length,1);
  assert.equal(commands[0].flagWhenCalled,false);
  assert.equal(commands[0].args[0],'/r');
  const again=await power.power_action({action:'restart',dryRun:false});
  assert.equal(again.status,'BLOCKED');
  assert.equal(commands.length,1);
});

test('wrong args, missing preconditions and no owner decision never set a durable gate',async()=>{
  const h=rig();
  for(const bad of [{action:'approve'},{action:'request',verified:true},{},{action:'status',channel:'rdp'}])
    await assert.rejects(()=>h.channel.logon_attestation(bad),/invalid_args/);
  const req=approved(await h.channel.logon_attestation({action:'request'}));
  h.consent.ownerDecide(req.consentId,'cancel');
  assert.equal(h.consent.take(req.consentId,'allow',req.target).cancelledByOwner,true);
  assert.equal(h.store.view.logonChannelVerified,false);
});
