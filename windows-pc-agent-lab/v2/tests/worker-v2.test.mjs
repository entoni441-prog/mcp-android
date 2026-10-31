import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,randomBytes,sign} from 'node:crypto';
import worker from '../worker-v2.mjs';

const now=()=>Math.floor(Date.now()/1000);
const id=()=>randomBytes(16).toString('hex');
class FakeD1{
  constructor(){this.gate=0;this.devices=new Map();this.writes=0;}
  prepare(sql){
    const db=this;let args=[];
    return {
      bind(...values){args=values;return this;},
      async first(){
        if(sql.startsWith('SELECT expires_at FROM v2_enrollment_gate'))return {expires_at:db.gate};
        if(sql.startsWith('SELECT COUNT(*)'))return {n:[...db.devices.values()].filter(d=>d.status==='pending'&&d.created_at>now()-900).length};
        if(sql.startsWith('SELECT fingerprint,status FROM v2_devices'))return db.devices.get(args[0])??null;
        if(sql.startsWith('SELECT public_jwk,status,created_at,last_seq'))return db.devices.get(args[0])??null;
        if(sql.startsWith('UPDATE v2_devices')){
          const [seq,last_seen_at,last_metrics_json,deviceId,expectedSeq]=args;
          const row=db.devices.get(deviceId);
          if(!row||row.status!=='approved'||row.last_seq>=expectedSeq||seq!==expectedSeq)return null;
          Object.assign(row,{last_seq:seq,last_seen_at,last_metrics_json});db.writes++;
          return {id:deviceId};
        }
        throw Error('Unknown D1 SELECT: '+sql);
      },
      async run(){
        if(!sql.startsWith('INSERT OR IGNORE INTO v2_devices'))throw Error('Unknown D1 INSERT: '+sql);
        const [deviceId,public_jwk,fingerprint,created_at]=args;
        if(!db.devices.has(deviceId))db.devices.set(deviceId,{id:deviceId,public_jwk,fingerprint,status:'pending',created_at,last_seq:0});
        db.writes++;return {success:true};
      }
    };
  }
}
const base='https://test.workers.dev';
async function api(db,route,body=null,method='POST'){
  const res=await worker.fetch(new Request(base+route,{method,headers:body?{'content-type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined}),{DB:db});
  return {http:res.status,data:await res.json()};
}
function keys(){
  const kp=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const k=kp.publicKey.export({format:'jwk'});
  const publicKey={kty:'EC',crv:'P-256',x:k.x,y:k.y};
  const fingerprint=createHash('sha256').update(JSON.stringify(publicKey)).digest('hex').slice(0,16);
  return {...kp,publicKey,fingerprint};
}
function signed(route,deviceId,priv,extra={}){
  const body={id:deviceId,timestamp:now(),nonce:id(),...extra};
  const text=['pc-agent-v2','POST',route,JSON.stringify(body)].join('\n');
  const signature=sign('sha256',Buffer.from(text),{key:priv,dsaEncoding:'ieee-p1363'}).toString('base64url');
  return {...body,signature};
}
const metrics={kind:'windows-readonly-v2',nodeVersion:'v24.21.0',uptimeSec:200,ramTotalGb:63.9,ramFreeGb:17.5};

async function register(db){
  const k=keys(),deviceId=id();
  const r=await api(db,'/v2/enroll',{id:deviceId,publicKey:k.publicKey});
  assert.equal(r.http,202,JSON.stringify(r));
  assert.equal(r.data.fingerprint,k.fingerprint);
  return {k,deviceId};
}

test('no unsolicited registration while gate closed, and no remote command routes',async()=>{
  const db=new FakeD1();
  const k=keys();const r=await api(db,'/v2/enroll',{id:id(),publicKey:k.publicKey});
  assert.equal(r.http,403);assert.equal(db.devices.size,0);
  for(const route of ['/v2/exec','/v2/jobs','/v2/reports','/v1/approve','/v2/admin','/']){
    assert.equal((await api(db,route)).http,404,route);
  }
  const health=await api(db,'/health',null,'GET');
  assert.equal(health.http,200);assert.equal(health.data.execution,'forbidden');
});

test('signed status, approval, signed heartbeats, and atomic replay/revocation defense',async()=>{
  const db=new FakeD1();db.gate=now()+900;
  const {k,deviceId}=await register(db);
  const goodStatus=signed('/v2/status',deviceId,k.privateKey);
  assert.equal((await api(db,'/v2/status',goodStatus)).data.status,'pending');
  assert.equal((await api(db,'/v2/heartbeat',signed('/v2/heartbeat',deviceId,k.privateKey,{seq:1,metrics}))).http,403);
  // Only privileged admin can perform this DB transition; no HTTP approval route.
  db.devices.get(deviceId).status='approved';
  assert.equal((await api(db,'/v2/status',signed('/v2/status',deviceId,k.privateKey))).data.lastSeq,0);
  const one=signed('/v2/heartbeat',deviceId,k.privateKey,{seq:1,metrics});
  assert.equal((await api(db,'/v2/heartbeat',one)).http,201);
  assert.equal((await api(db,'/v2/heartbeat',one)).http,409,'identical signed replay blocked');
  const two=signed('/v2/heartbeat',deviceId,k.privateKey,{seq:2,metrics});
  assert.equal((await api(db,'/v2/heartbeat',two)).http,201);
  assert.equal((await api(db,'/v2/status',signed('/v2/status',deviceId,k.privateKey))).data.lastSeq,2);
  assert.deepEqual(JSON.parse(db.devices.get(deviceId).last_metrics_json),metrics);
  db.devices.get(deviceId).status='rejected';
  assert.equal((await api(db,'/v2/heartbeat',signed('/v2/heartbeat',deviceId,k.privateKey,{seq:3,metrics}))).http,403);
  assert.equal((await api(db,'/v2/status',signed('/v2/status',deviceId,k.privateKey))).data.status,'rejected');
});

test('forged signatures, cross-route replay, stale timestamps and invalid metrics rejected',async()=>{
  const db=new FakeD1();db.gate=now()+900;
  const {k,deviceId}=await register(db);
  db.devices.get(deviceId).status='approved';
  const forged=signed('/v2/status',deviceId,keys().privateKey);
  assert.equal((await api(db,'/v2/status',forged)).http,403);
  const mismatched=signed('/v2/status',deviceId,k.privateKey,{seq:1,metrics});
  assert.equal((await api(db,'/v2/heartbeat',mismatched)).http,403);
  const wrongRoute=signed('/v2/status',deviceId,k.privateKey);
  assert.equal((await api(db,'/v2/heartbeat',wrongRoute)).http,400);
  const old=signed('/v2/status',deviceId,k.privateKey,{timestamp:now()-900});
  assert.equal((await api(db,'/v2/status',old)).http,403);
  const invalid=signed('/v2/heartbeat',deviceId,k.privateKey,{seq:1,metrics:{...metrics,processes:['private']}});
  assert.equal((await api(db,'/v2/heartbeat',invalid)).http,400);
  const signedForOtherRoute=signed('/v2/status',deviceId,k.privateKey);
  const statusShape={...signedForOtherRoute,seq:1,metrics};
  assert.equal((await api(db,'/v2/heartbeat',statusShape)).http,403);
  assert.equal(db.devices.get(deviceId).last_seq,0);
});

test('no public metrics read and no approval by HTTP',async()=>{
  const db=new FakeD1();db.gate=now()+900;const {deviceId}=await register(db);
  for(const route of ['/v2/approve','/v2/metrics','/v2/commands'])assert.equal((await api(db,route,{id:deviceId})).http,404);
});
