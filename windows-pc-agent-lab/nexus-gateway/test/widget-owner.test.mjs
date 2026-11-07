import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {GuardCore} from '../src/guard-core.mjs';
import {handleWidgetConsent, widgetOriginAllowed} from '../src/widget-consent.mjs';
import {WIDGET_HTML, widgetContents} from '../src/widget.mjs';

const ORIGIN = 'https://nexus-local.web-sandbox.oaiusercontent.com';
const PASS = 'one-owner-only-passphrase-do-not-log';
const sha = async s=>crypto.createHash('sha256').update(s).digest('hex');
const make = async () => {
  const store=new Map();
  const storage={
    get:async k=>store.get(k),
    put:async(k,v)=>{store.set(k, structuredClone(v));},
    delete:async k=>store.delete(k)
  };
  const guard=new GuardCore(storage);
  const calls=[];
  const ownerRequests=[
    {consentId:'012345abcdef',target:'change power R3',expiresInSec:300,options:['allow','cancel']},
  ];
  const env={OWNER_PASSPHRASE_SHA256: await sha(PASS),
    CONSENT_GUARD:{idFromName:n=>n,get:()=>guard}};
  const deps={sha256hex:sha,signDecision:async(_env,a)=>'mock-signed-'+a.consentId,
    callHost:async(name,args)=>{calls.push({name,args});
      if(name==='owner_consents')return {ok:true,result:{structuredContent:{pending:ownerRequests}}};
      if(name==='owner_decide')return {ok:true,result:{structuredContent:{ok:true}}};
      return {ok:false,reason:'unexpected'};
    }};
  async function post(path,body,{origin=ORIGIN,header=true}={}){
    return handleWidgetConsent(new Request('https://nexus-gateway.entoni441.workers.dev'+path,
      {method:'POST',headers:{origin,'content-type':'application/json',...(header?{'x-nexus-widget':'1'}:{})},body:JSON.stringify(body)}),env,deps);
  }
  return {post,calls,guard,env,deps,ownerRequests};
};
test('NX-CHAT-OWNER: origin restricted to ChatGPT sandbox only',async()=>{
  assert.equal(widgetOriginAllowed(ORIGIN),true);
  for(const origin of ['https://example.org','https://evil.web-sandbox.oaiusercontent.com.attacker.org',
    'http://nexus-local.web-sandbox.oaiusercontent.com','https://chatgpt.com','']){
    assert.equal(widgetOriginAllowed(origin),false,origin);
  }
  const t=await make();const r=await t.post('/live/widget/challenge',{operation:'list'},{origin:'https://evil.org'});
  assert.equal(r.status,403);assert.equal(t.calls.length,0);
});
test('NX-CHAT-OWNER: preflight allows only explicit origin & needed headers; no cookies',async()=>{
  const t=await make();
  const r=await handleWidgetConsent(new Request('https://nexus-gateway.entoni441.workers.dev/live/widget/challenge',
    {method:'OPTIONS',headers:{origin:ORIGIN}}),t.env,t.deps);
  assert.equal(r.status,204);
  assert.equal(r.headers.get('access-control-allow-origin'),ORIGIN);
  assert.equal(r.headers.get('access-control-allow-credentials'),null);
  assert.equal(r.headers.get('vary'),'Origin');
});
test('NX-CHAT-OWNER: read pending requires per-action passphrase, nonce burns once, no decision signed',async()=>{
  const t=await make();
  const c=await t.post('/live/widget/challenge',{operation:'list'});
  assert.equal(c.status,200);
  const {nonce}=await c.json();
  assert.match(nonce,/^[a-f0-9]{64}$/);
  assert.equal(t.calls.length,0);
  const q=await t.post('/live/widget/perform',{nonce,passphrase:PASS});
  assert.equal(q.status,200);
  const j=await q.json();assert.equal(j.pending.length,1);
  assert.equal(j.pending[0].consentId,'012345abcdef');
  assert.deepEqual(t.calls.map(x=>x.name),['owner_consents']);
  const replay=await t.post('/live/widget/perform',{nonce,passphrase:PASS});
  assert.equal(replay.status,400);assert.equal((await replay.json()).error,'invalid');
  assert.equal(t.calls.length,1);
});
test('NX-CHAT-OWNER: owner can approve only after reauth for exact consent+decision; signed once',async()=>{
  const t=await make();
  const c=await t.post('/live/widget/challenge',{operation:'decide',consentId:'012345abcdef',decision:'allow'});
  const {nonce}=await c.json();
  const out=await t.post('/live/widget/perform',{nonce,passphrase:PASS});
  assert.equal(out.status,200);assert.equal((await out.json()).ok,true);
  assert.equal(t.calls.length,1);
  assert.equal(t.calls[0].name,'owner_decide');
  assert.equal(t.calls[0].args.consentId,'012345abcdef');
  assert.equal(t.calls[0].args.decision,'allow');
  assert.match(t.calls[0].args.sig,/^mock-signed-/);
  assert.equal(t.calls[0].args.passphrase,undefined);
  assert.equal(t.calls[0].args.passphraseSha256,undefined);
  const replay=await t.post('/live/widget/perform',{nonce,passphrase:PASS});
  assert.equal(replay.status,400);assert.equal(t.calls.length,1);
});
test('NX-CHAT-OWNER: invalid password consumes challenge; shared 5-fail lockout',async()=>{
  const t=await make();
  for(let i=0;i<5;i++){
    const n=await(await t.post('/live/widget/challenge',{operation:'decide',consentId:'012345abcdef',decision:'allow'})).json();
    const r=await t.post('/live/widget/perform',{nonce:n.nonce,passphrase:'invalid'});
    assert.equal(r.status,i===4?403:403);
  }
  const n=await(await t.post('/live/widget/challenge',{operation:'decide',consentId:'012345abcdef',decision:'allow'})).json();
  const r=await t.post('/live/widget/perform',{nonce:n.nonce,passphrase:PASS});
  assert.equal(r.status,429);
  assert.equal(t.calls.length,0);
});
test('NX-CHAT-OWNER: malformed actions, no header, expiry nonce or origin cross-call are fail-closed',async()=>{
  const t=await make();
  for(const body of [{operation:'decide',consentId:'not-hex',decision:'allow'},
    {operation:'list',decision:'allow'}, {operation:'decide',consentId:'012345abcdef',decision:'reboot'},
    {operation:'list',command:'run'}]){
    const r=await t.post('/live/widget/challenge',body);assert.equal(r.status,400);
  }
  assert.equal((await t.post('/live/widget/challenge',{operation:'list'},{header:false})).status,403);
  const n=await(await t.post('/live/widget/challenge',{operation:'list'})).json();
  const wrongOrigin=await t.post('/live/widget/perform',{nonce:n.nonce,passphrase:PASS},
    {origin:'https://another.web-sandbox.oaiusercontent.com'});
  assert.equal(wrongOrigin.status,403);
  assert.equal(t.calls.length,0);
});
test('NX-CHAT-OWNER: widget talks direct HTTPS to Gateway and not via tools/call for privileged approvals',()=>{
  assert.match(WIDGET_HTML,/OWNER_ORIGIN = 'https:\/\/nexus-gateway\.entoni441\.workers\.dev'/);
  assert.match(WIDGET_HTML,/credentials:'omit'/);
  assert.match(WIDGET_HTML,/ownerPost\('\/live\/widget\/challenge'/);
  assert.match(WIDGET_HTML,/ownerPost\('\/live\/widget\/perform'/);
  assert.doesNotMatch(WIDGET_HTML,/callTool\('owner_decide'/);
  assert.doesNotMatch(WIDGET_HTML,/localStorage|sessionStorage/);
  const contents=widgetContents();
  assert.ok(contents[0]._meta.ui.csp.connectDomains.includes('https://nexus-gateway.entoni441.workers.dev'));
  const src=WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(()=>new Function(src),'Widget JS parses');
});
