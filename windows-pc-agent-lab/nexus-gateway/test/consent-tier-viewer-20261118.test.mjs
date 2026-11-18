import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDefault,sha256hex} from '../src/handlers.mjs';
import {COOKIE,makeSession} from '../src/live-page.mjs';
import {fakeGuardNamespace} from './fake-guard.mjs';

test('Live View labels chat-only requests without creating an owner decision button',async()=>{
  const kv=new Map();
  const env={NEXUS_TOKEN:'k'.repeat(43),OWNER_PASSPHRASE_SHA256:await sha256hex('test-owner'),
    CONSENT_GUARD:fakeGuardNamespace().ns,
    OAUTH_KV:{get:async k=>kv.get(k)??null,put:async(k,v)=>kv.set(k,v),delete:async k=>kv.delete(k)}};
  const cookie=await makeSession(env);
  const res=await handleDefault(new Request('https://nexus-gateway.example.workers.dev/live',{headers:{cookie:COOKIE+'='+cookie}}),env);
  assert.equal(res.status,200);
  const html=await res.text();
  assert.match(html,/Запросов для согласования в чате ChatGPT/);
  assert.match(html,/Эта страница не может их подтвердить/);
  assert.match(html,/j\.pendingChatConsents/);
  const scripts=[...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)].map(x=>x[1]);
  assert.ok(scripts.length>=1);
  for(const script of scripts)assert.doesNotThrow(()=>new Function(script));
});
