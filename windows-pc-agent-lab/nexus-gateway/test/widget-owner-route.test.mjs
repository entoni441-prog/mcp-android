import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDefault, sha256hex} from '../src/handlers.mjs';
import {fakeGuardNamespace} from './fake-guard.mjs';

const ORIGIN='https://nexus-widget.web-sandbox.oaiusercontent.com';
const PASS='local-owner-test-passphrase';
const GW='https://nexus-gateway.entoni441.workers.dev';
const TUN='https://abc-def.trycloudflare.com';
const mk=async()=>{
  const store=new Map([['tunnel',JSON.stringify({url:TUN,registeredAt:Date.now()})]]);
  const calls=[];
  const env={
    OWNER_PASSPHRASE_SHA256:await sha256hex(PASS),
    NEXUS_TOKEN:'testtoken'.repeat(8),
    CONSENT_GUARD:fakeGuardNamespace().ns,
    OAUTH_KV:{get:async k=>store.get(k)??null,put:async(k,v)=>store.set(k,v)}
  };
  const fetcher=async(uri,opts)=>{
    calls.push(JSON.parse(opts.body).params);
    const x=JSON.parse(opts.body).params;
    let r=x.name==='owner_consents'
      ? {structuredContent:{pending:[{consentId:'123456abcdef',target:'approve power',options:['allow','cancel'],expiresInSec:240}]}}
      : {structuredContent:{ok:true}};
    return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:r}),{status:200,
      headers:{'content-type':'application/json'}});
  };
  const post=(path,body,origin=ORIGIN)=>handleDefault(new Request(GW+path,{
    method:'POST',headers:{origin,'x-nexus-widget':'1','content-type':'application/json'},
    body:JSON.stringify(body)}),env,{fetcher});
  return {post,calls,env};
};
test('NX-CHAT-OWNER routed through /live/widget/challenge and /perform; no MCP owner tool exposed',async()=>{
  const t=await mk();
  const c=await t.post('/live/widget/challenge',{operation:'list'});
  assert.equal(c.status,200);
  const {nonce}=await c.json();
  const r=await t.post('/live/widget/perform',{nonce,passphrase:PASS});
  assert.equal(r.status,200);
  assert.equal((await r.json()).pending[0].consentId,'123456abcdef');
  assert.equal(t.calls[0].name,'owner_consents');
  assert.equal(t.calls[0].arguments?.passphrase,undefined);
  assert.equal(t.calls.length,1);
});
test('NX-CHAT-OWNER end-to-end signed decision without secret in Host RPC',async()=>{
  const t=await mk();
  const n=await(await t.post('/live/widget/challenge',
    {operation:'decide',consentId:'123456abcdef',decision:'allow'})).json();
  const d=await t.post('/live/widget/perform',{nonce:n.nonce,passphrase:PASS});
  assert.equal(d.status,200);
  const call=t.calls[0];
  assert.equal(call.name,'owner_decide');
  assert.equal(call.arguments?.consentId,'123456abcdef');
  assert.equal(call.arguments?.decision,'allow');
  assert.match(call.arguments?.sig,/^[A-Za-z0-9_-]+$/);
  assert.equal(call.arguments?.passphrase,undefined);
  assert.equal(call.arguments?.passphraseSha256,undefined);
});
