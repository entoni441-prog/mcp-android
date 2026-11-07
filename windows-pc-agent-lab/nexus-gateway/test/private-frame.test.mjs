import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {makePrivateTicket,verifyPrivateTicket,handlePrivateFrame,PRIVATE_FRAME_TTL_MS} from '../src/private-frame.mjs';
import {handleWidgetConsent} from '../src/widget-consent.mjs';
import {fakeGuardNamespace} from './fake-guard.mjs';
import {TOOLS} from '../src/catalog.mjs';
import {WIDGET_HTML} from '../src/widget.mjs';
const ORIGIN='https://nexus-private.web-sandbox.oaiusercontent.com';
const OTHER='https://another.web-sandbox.oaiusercontent.com';
const PASS='owner-test-private-passphrase';
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const JPEG=Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3,0xff,0xd9]).toString('base64');
const env=()=>({NEXUS_TOKEN:'s'.repeat(43),LIVE_SESSION_EPOCH:'1',
  OWNER_PASSPHRASE_SHA256:digest(PASS),CONSENT_GUARD:fakeGuardNamespace().ns});
function req(body,origin=ORIGIN,ticket=''){
  return new Request('https://nexus-gateway.entoni441.workers.dev/live/widget/private-frame',{
    method:'POST',headers:{origin,'content-type':'application/json','x-nexus-widget':'1',
      ...(ticket?{'authorization':'Bearer '+ticket}:{})},body:JSON.stringify(body)});
}
test('private owner token: origin-bound 3min, tamper and epoch invalid',async()=>{
  const e=env();const now=Date.now();
  const t=await makePrivateTicket(e,ORIGIN,now);
  assert.equal(await verifyPrivateTicket(e,t,ORIGIN,now+1000),true);
  assert.equal(await verifyPrivateTicket(e,t,OTHER,now+1000),false);
  assert.equal(await verifyPrivateTicket(e,t,ORIGIN,now+PRIVATE_FRAME_TTL_MS+1),false);
  assert.equal(await verifyPrivateTicket({...e,LIVE_SESSION_EPOCH:'2'},t,ORIGIN,now),false);
  const bad=t.slice(0,-1)+(t.at(-1)==='A'?'B':'A');
  assert.equal(await verifyPrivateTicket(e,bad,ORIGIN,now),false);
  await assert.rejects(makePrivateTicket(e,'https://evil.example.org'),/private_view_bad_origin/);
});
test('direct private frame requires bearer, exact Origin, and signed Host-only owner_frame',async()=>{
  const e=env();const calls=[];
  const deps={signOwnerFrame:async(_e,x)=>'signature-for-'+x.nonce,
    callHost:async(name,args)=>{calls.push({name,args});return {ok:true,result:{
      structuredContent:{state:'live',imageW:960,imageH:540,screenW:1280,screenH:720,cursor:{x:2,y:3}},
      content:[{type:'image',mimeType:'image/jpeg',data:JPEG}]}};}};
  const t=await makePrivateTicket(e,ORIGIN);
  assert.equal((await handlePrivateFrame(req({maxWidth:960}),e,deps)).status,401);
  assert.equal((await handlePrivateFrame(req({maxWidth:960},OTHER,t),e,deps)).status,401);
  assert.equal((await handlePrivateFrame(req({maxWidth:960,arbitrary:true},ORIGIN,t),e,deps)).status,400);
  assert.equal(calls.length,0);
  const r=await handlePrivateFrame(req({maxWidth:960},ORIGIN,t),e,deps);
  assert.equal(r.status,200);
  assert.equal(r.headers.get('access-control-allow-origin'),ORIGIN);
  assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal(r.headers.get('access-control-allow-credentials'),null);
  assert.equal(r.headers.get('x-nexus-frame'),'960,540,1280,720,2,3');
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())].slice(0,3),[255,216,255]);
  assert.deepEqual(calls.map(x=>x.name),['owner_frame']);
  assert.match(calls[0].args.nonce,/^[a-f0-9]{32}$/);
  assert.equal(calls[0].args.maxWidth,960);
  assert.equal(typeof calls[0].args.ts,'number');
  assert.equal(calls[0].args.sig,'signature-for-'+calls[0].args.nonce);
});
test('widget private auth uses one-time owner challenge; no model-visible passwords or tickets',async()=>{
  const e=env();const calls=[];
  const deps={sha256hex:async s=>digest(s),signDecision:async()=>null,
    callHost:async(...a)=>{calls.push(a);throw Error('should never call host during ticket issuance');}};
  const uri='https://nexus-gateway.entoni441.workers.dev/live/widget/';
  const post=(op,body)=>handleWidgetConsent(new Request(uri+op,{method:'POST',
    headers:{origin:ORIGIN,'x-nexus-widget':'1','content-type':'application/json'},
    body:JSON.stringify(body)}),e,deps);
  const c=await post('challenge',{operation:'private_view'});
  assert.equal(c.status,200);const {nonce}=await c.json();
  const p=await post('perform',{nonce,passphrase:PASS});
  assert.equal(p.status,200);
  const j=await p.json();
  assert.equal(j.scope,'owner_private_frames_only');
  assert.equal(j.expiresInSec,180);
  assert.equal(await verifyPrivateTicket(e,j.viewerToken,ORIGIN),true);
  assert.equal((await post('perform',{nonce,passphrase:PASS})).status,400);
  assert.equal(calls.length,0);
  assert.equal(TOOLS.some(x=>x.name==='owner_frame'),false);
  assert.match(WIDGET_HTML,/getViewFrame/);
  assert.match(WIDGET_HTML,/private-frame/);
  assert.doesNotMatch(WIDGET_HTML,/callTool\('owner_frame'/);
  assert.doesNotMatch(WIDGET_HTML,/localStorage|sessionStorage/);
});
