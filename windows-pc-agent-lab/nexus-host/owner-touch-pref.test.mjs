import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadConfig,createRuntime,handleRpc} from './server.mjs';
import {TOOLS} from './catalog.mjs';

function harness(home){
  const cfg=loadConfig({NEXUS_HOME:home,NEXUS_TOKEN:'x'.repeat(40),NEXUS_WORKSPACE:path.join(home,'ws'),
    NEXUS_CAPABILITIES_JSON:JSON.stringify({gui_input:true,screen_capture:true,ui_read:true,live_view:true})});
  fs.mkdirSync(cfg.workspace,{recursive:true});
  cfg.runtime=createRuntime(cfg,{guiDeps:{platform:'win32',runUia:async()=>({})},
    sessionDeps:{setIntervalFn:()=>null,clearIntervalFn:()=>{}}});
  return {
    call: async(name,args={})=>{
      const res=await handleRpc({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},cfg);
      return res.result?.isError ? {error:res.result.content?.map(c=>c.text).join('\n')} : res.result?.structuredContent;
    },
    stop:()=>cfg.runtime.stop(),
  };
}

test('owner UI preference is app-only, durable and not a permission grant',async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'nx-owner-touch-'));
  const meta=TOOLS.find(t=>t.name==='owner_ui_pref');
  assert.deepEqual(meta?._meta?.ui?.visibility,['app']);
  assert.equal(meta?.inputSchema?.additionalProperties,false);
  const a=harness(home);
  assert.equal((await a.call('owner_ui_pref',{action:'get'})).enabled,false);
  assert.equal((await a.call('owner_ui_pref',{action:'set',enabled:true})).enabled,true);
  const file=JSON.parse(fs.readFileSync(path.join(home,'owner-touch-pref.json'),'utf8'));
  assert.deepEqual(file,{enabled:true,version:1});
  assert.equal((await a.call('owner_ui_pref',{action:'get'})).enabled,true);
  assert.match((await a.call('owner_ui_pref',{action:'set',enabled:'true'})).error,/invalid_args/);
  assert.match((await a.call('owner_ui_pref',{action:'set',enabled:true,capability:'gui_input'})).error,/invalid_args/);
  a.stop();
  const b=harness(home);
  assert.equal((await b.call('owner_ui_pref',{action:'get'})).enabled,true,'survives Host process restart');
  b.stop();
});

test('owner STOP clears preference; cannot re-enable until explicit resume',async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'nx-touch-stop-'));
  const a=harness(home);
  assert.equal((await a.call('owner_ui_pref',{action:'set',enabled:true})).enabled,true);
  // No desktop work required to prove stop semantics.
  const stop=await a.call('live_control',{action:'stop'});
  assert.equal(stop.taskStopped,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await a.call('owner_ui_pref',{action:'get'})).enabled,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home,'owner-touch-pref.json'),'utf8')).enabled,false);
  assert.match((await a.call('owner_ui_pref',{action:'set',enabled:true})).error,/owner_control_unavailable/);
  assert.equal((await a.call('owner_ui_pref',{action:'set',enabled:false})).enabled,false);
  a.stop();
});

test('preference cannot bypass a disabled GUI capability',async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'nx-touch-cap-'));
  const cfg=loadConfig({NEXUS_HOME:home,NEXUS_TOKEN:'x'.repeat(40),NEXUS_WORKSPACE:path.join(home,'ws'),
    NEXUS_CAPABILITIES_JSON:JSON.stringify({gui_input:false,screen_capture:true,ui_read:true,live_view:true})});
  fs.mkdirSync(cfg.workspace,{recursive:true});
  cfg.runtime=createRuntime(cfg,{sessionDeps:{setIntervalFn:()=>null,clearIntervalFn:()=>{}}});
  const call=async args=>{
    const r=await handleRpc({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'owner_ui_pref',arguments:args}},cfg);
    return r.result?.isError ? {error:r.result.content.map(x=>x.text).join('')} : r.result.structuredContent;
  };
  assert.equal((await call({action:'get'})).enabled,false);
  assert.match((await call({action:'set',enabled:true})).error,/owner_control_unavailable/);
  cfg.runtime.stop();
});
