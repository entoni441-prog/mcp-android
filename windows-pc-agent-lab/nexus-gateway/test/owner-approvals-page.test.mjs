import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDefault,sha256hex} from '../src/handlers.mjs';
import {fakeGuardNamespace} from './fake-guard.mjs';
import {COOKIE,makeSession} from '../src/live-page.mjs';

const BASE='https://nexus-gateway.example.workers.dev';
async function fixture(){
  const kv=new Map();
  return {
    OWNER_PASSPHRASE_SHA256:await sha256hex('test-owner-passphrase'),
    NEXUS_TOKEN:'k'.repeat(43),
    CONSENT_GUARD:fakeGuardNamespace().ns,
    OAUTH_KV:{get:async k=>kv.get(k)??null,put:async(k,v)=>kv.set(k,v),delete:async k=>kv.delete(k)}
  };
}
test('separate approval URL requires owner auth; no Windows frame or secret in widget',async()=>{
  const env=await fixture();
  const unauthorized=await handleDefault(new Request(BASE+'/live/approvals'),env);
  assert.equal(unauthorized.status,200);
  const login=await unauthorized.text();
  assert.match(login,/action="\/live\/login\?return=approvals"/);
  assert.doesNotMatch(login,/<img[^>]+id="i"/);
  assert.equal((await handleDefault(new Request(BASE+'/live/consents'),env)).status,401);

  const session=await makeSession(env);
  const page=await handleDefault(new Request(BASE+'/live/approvals',{headers:{cookie:COOKIE+'='+session}}),env);
  assert.equal(page.status,200);
  const html=await page.text();
  assert.match(html,/Подтверждение NEXUS/);
  assert.match(html,/\/live\/consents/);
  assert.match(html,/\/live\/decide/);
  assert.match(html,/window\.close\(\)/);
  assert.doesNotMatch(html,/<img[^>]*>/);
  assert.doesNotMatch(html,/\/live\/frame/);
  const script=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(()=>new Function(script));
});
test('approval-only login redirects to approvals, not Live screen; no arbitrary redirect',async()=>{
  const env=await fixture();
  const first=await handleDefault(new Request(BASE+'/live/approvals'),env);
  const page=await first.text();
  const nonce=page.match(/name="nonce" value="([a-f0-9]{64})"/)?.[1];
  assert.ok(nonce);
  const form=new URLSearchParams({nonce,passphrase:'test-owner-passphrase'});
  const logged=await handleDefault(new Request(BASE+'/live/login?return=approvals',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form
  }),env);
  assert.equal(logged.status,303);
  assert.equal(logged.headers.get('location'),'/live/approvals');
  assert.match(logged.headers.get('set-cookie')||'',/HttpOnly/);
  const other=await handleDefault(new Request(BASE+'/live/login?return=https://evil.invalid',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({nonce:'invalid'})
  }),env);
  assert.equal(other.status,400);
  const body=await other.text();
  assert.match(body,/action="\/live\/login"/);
  assert.doesNotMatch(body,/return=https/);
});
