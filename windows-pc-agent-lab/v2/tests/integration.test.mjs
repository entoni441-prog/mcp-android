import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import combined from '../.dist/worker-combined.mjs';
const db={prepare(sql){return {bind(){return this;},async first(){
  if(sql.includes('v2_enrollment_gate'))return {expires_at:0};
  return null;
},async run(){throw Error('Unexpected D1 write in closed-gate test');}}}};
async function req(route,method='GET',body){
  const x=await combined.fetch(new Request('https://lab.example.workers.dev'+route,{method,
    headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined}),{DB:db});
  return {status:x.status,data:await x.json()};
}
test('existing v1 health route stays identical',async()=>{
  const x=await req('/health');
  assert.equal(x.status,200);
  assert.equal(x.data.component,'pc-agent-readonly-lab');
  assert.equal(x.data.execution,'forbidden');
});
test('existing v1 protected surfaces stay inaccessible',async()=>{
  assert.equal((await req('/v1/approve','POST',{id:'a'})).status,404);
  assert.equal((await req('/v1/reports')).status,404);
  assert.equal((await req('/v1/status?id=bad')).status,400);
});
test('v2 is isolated and enrollment gate starts closed',async()=>{
  const x=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'jwk'});
  const body={id:randomBytes(16).toString('hex'),publicKey:{kty:'EC',crv:'P-256',x:x.x,y:x.y}};
  const r=await req('/v2/enroll','POST',body);
  assert.equal(r.status,403);assert.equal(r.data.error,'enrollment_closed');
  assert.equal((await req('/v2/exec','POST',{command:'whoami'})).status,404);
  assert.equal((await req('/v2/reports')).status,404);
});
