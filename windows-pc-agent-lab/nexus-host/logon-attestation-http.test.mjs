import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer,loadConfig} from './server.mjs';
import {withOwnerKey,signed,foreignKey} from './owner-key-helper.test.mjs';

const service = [{Name:'chromoting',State:'Running',StartMode:'Auto',StartName:'LocalSystem'}];
const autostart={tasks:[{name:'NEXUS-Host-Logon',state:'Ready',triggers:['MSFT_TaskLogonTrigger']}]};
test('HTTP owner signed request: public model cannot self-approve a logon attestation',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-attest-http-'));
  const home=path.join(root,'h');fs.mkdirSync(home);
  const cfg=loadConfig({NEXUS_HOME:home,NEXUS_WORKSPACE:path.join(root,'ws'),NEXUS_PORT:'0'});
  withOwnerKey(cfg);
  const server=createServer(cfg,{diagDeps:{platform:'win32',run:async script=>{
    if(script.includes('Win32_Service'))return JSON.stringify(service);
    if(script.includes('Get-ScheduledTask'))return JSON.stringify(autostart);
    if(script.includes('powercfg.exe'))return JSON.stringify({sleepStates:[]});
    return '{}';
  }}});
  await new Promise(res=>server.listen(0,'127.0.0.1',res));
  const url='http://127.0.0.1:'+server.address().port+'/mcp';
  let next=0;
  const call=async(name,args={})=>{
    const response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+cfg.token,'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:++next,method:'tools/call',params:{name,arguments:args}})});
    assert.equal(response.status,200);
    return (await response.json()).result;
  };
  try{
    assert.equal((await call('logon_attestation',{action:'status'})).structuredContent.verified,false);
    const req=(await call('logon_attestation',{action:'request'})).structuredContent;
    assert.equal(req.status,'consent_required');assert.equal(req.approval,'owner_phone');
    assert.match(req.target,/полного выхода/);
    assert.equal((await call('confirm_action',{consentId:req.consentId,decision:'allow',target:req.target})).isError,true);
    assert.equal((await call('owner_decide',signed(req.consentId,'allow',Date.now(),foreignKey))).isError,true,
      'wrong private key must be rejected even with the PC bearer token');
    assert.equal((await call('logon_attestation',{action:'status'})).structuredContent.verified,false);
    const legit=await call('owner_decide',signed(req.consentId,'allow'));
    assert.equal(legit.isError,false);
    const applied=(await call('confirm_action',{consentId:req.consentId,decision:'allow',target:req.target}));
    assert.equal(applied.isError,false);
    assert.equal(applied.structuredContent.result.verified,true);
    const state=(await call('logon_attestation',{action:'status'})).structuredContent;
    assert.equal(state.verified,true);
    assert.equal((await call('power_action',{action:'restart',dryRun:true})).structuredContent.preconditions.logonChannelVerified,true);
    assert.equal((await call('confirm_action',{consentId:req.consentId,decision:'allow',target:req.target})).isError,true,'single-use');
    assert.equal((await call('set_capability',{capability:'logonChannelVerified',enabled:true})).isError,true);
    const revoke=await call('logon_attestation',{action:'revoke'});
    assert.equal(revoke.structuredContent.verified,false);
    assert.equal((await call('logon_attestation',{action:'status'})).structuredContent.verified,false);
  }finally{
    server.close();cfg.runtime?.stop();
  }
});
