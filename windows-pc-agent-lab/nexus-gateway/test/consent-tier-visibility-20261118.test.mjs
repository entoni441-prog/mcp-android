import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDefault, sha256hex} from '../src/handlers.mjs';
import {COOKIE, makeSession} from '../src/live-page.mjs';
import {fakeGuardNamespace} from './fake-guard.mjs';

const ORIGIN = 'https://nexus-gateway.example.workers.dev';
async function fixture() {
  const kv = new Map([['tunnel',JSON.stringify({url:'https://abc-def-ghi.trycloudflare.com',registeredAt:Date.now()})]]);
  return {NEXUS_TOKEN:'k'.repeat(43),OWNER_PASSPHRASE_SHA256:await sha256hex('owner-test-only'),
    CONSENT_GUARD:fakeGuardNamespace().ns,
    OAUTH_KV:{get:async k=>kv.get(k)??null,put:async(k,v)=>kv.set(k,v),delete:async k=>kv.delete(k)}};
}
function fakeHost({ownerPending=[],diagnostics={pendingConsents:1},diagnosticError=false}={}) {
  const calls=[];
  const fetcher=async(_url,init={})=>{
    const m=JSON.parse(init.body);calls.push(m.params.name);
    if(diagnosticError&&m.params.name==='host_diagnostics')return new Response('unavailable',{status:503});
    const structuredContent=m.params.name==='owner_consents'?{pending:ownerPending}:
      m.params.name==='host_diagnostics'?diagnostics:{};
    return new Response(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[],structuredContent}}),
      {status:200,headers:{'content-type':'application/json'}});
  };
  return {calls,fetcher};
}
const withSession=(c,path='/live/consents')=>new Request(ORIGIN+path,{headers:{cookie:COOKIE+'='+c}});

test('chat-only repeat visible as count, never actionable as owner consent',async()=>{
  const e=await fixture(), c=await makeSession(e), host=fakeHost();
  const r=await handleDefault(withSession(c),e,{fetcher:host.fetcher});
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{pending:[],pendingChatConsents:1});
  assert.deepEqual(host.calls,['owner_consents','host_diagnostics']);
  assert.ok(!host.calls.includes('owner_decide'));
});

test('mixed owner/live and chat requests stay in separate tiers',async()=>{
  const e=await fixture(),c=await makeSession(e);
  const ownerPending=[{consentId:'a1b2c3d4e5f6',what:'protected_file',target:'Protected read',kind:'grant',options:['allow','cancel'],decided:null,expiresInSec:240}];
  const host=fakeHost({ownerPending,diagnostics:{pendingConsents:2,pendingChatConsents:1}});
  const response=await handleDefault(withSession(c),e,{fetcher:host.fetcher});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{pending:ownerPending,pendingChatConsents:1});
});

test('legacy Host fallback and diagnostics outage do not invent requests',async()=>{
  const e=await fixture(),c=await makeSession(e);
  const old=fakeHost({diagnostics:{pendingConsents:0}});
  assert.deepEqual(await (await handleDefault(withSession(c),e,{fetcher:old.fetcher})).json(),{pending:[],pendingChatConsents:0});
  const unavailable=fakeHost({diagnosticError:true});
  const response=await handleDefault(withSession(c),e,{fetcher:unavailable.fetcher});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{pending:[],pendingChatConsents:null});
});

test('owner session mandatory and approval page states separate channel without fake buttons',async()=>{
  const e=await fixture();
  assert.equal((await handleDefault(new Request(ORIGIN+'/live/consents'),e)).status,401);
  const c=await makeSession(e);
  const p=await handleDefault(withSession(c,'/live/approvals'),e);
  assert.equal(p.status,200);
  const html=await p.text();
  assert.match(html,/Запросов для согласования в чате ChatGPT/);
  assert.match(html,/Эта страница не может их подтвердить/);
  assert.match(html,/data\.pendingChatConsents/);
  assert.match(html,/\/live\/decide/);
  assert.doesNotMatch(html,/chatOnly.*onclick/);
  const script=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);assert.doesNotThrow(()=>new Function(script));
});
