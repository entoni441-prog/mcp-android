import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,createHash,randomBytes,sign} from "node:crypto";
import worker from "../worker.mjs";

class FakeDB {
  constructor(){this.gate=Math.floor(Date.now()/1000)+600;this.devices=new Map();this.reports=new Map();}
  prepare(sql){
    const db=this;
    let params=[];
    return {
      bind(...items){params=items;return this;},
      async first(){
        if(sql.includes("enrollment_gate")) return {expires_at:db.gate};
        if(sql.includes("COUNT(*)")) return {n:0};
        if(sql.includes("SELECT fingerprint,status")) return db.devices.get(params[0]);
        if(sql.includes("SELECT status,created_at,approved_at")) return db.devices.get(params[0]);
        if(sql.includes("SELECT public_jwk,status,approved_at")) return db.devices.get(params[0]);
        if(sql.includes("SELECT 1 AS n FROM reports")) return db.reports.has(params[0])?{n:1}:null;
        throw Error("unsupported query: "+sql);
      },
      async run(){
        if(sql.includes("INSERT OR IGNORE INTO devices")) {
          const [id,public_jwk,fingerprint,created_at]=params;
          if(!db.devices.has(id)) db.devices.set(id,{id,public_jwk,fingerprint,created_at,approved_at:null,status:"pending"});
        } else if(sql.includes("INSERT INTO reports")) {
          const [device_id,received_at,report_json]=params;
          db.reports.set(device_id,{received_at,report_json});
        } else throw Error("unsupported statement: "+sql);
        return {success:true};
      }
    };
  }
}

const base="https://lab.example.workers.dev";
async function api(db,path,method="GET",payload=null){
  const r=await worker.fetch(new Request(base+path,{method,headers:payload?{"content-type":"application/json"}:undefined,body:payload?JSON.stringify(payload):undefined}),{DB:db});
  return {status:r.status,body:await r.json()};
}
test("real P-256 enrollment + administrator approval + signed report + no replay",async()=>{
  const db=new FakeDB();
  const id=randomBytes(16).toString("hex");
  const {privateKey,publicKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
  const x=publicKey.export({format:"jwk"});
  const publicKeyJwk={kty:"EC",crv:"P-256",x:x.x,y:x.y};
  const fingerprint=createHash("sha256").update(JSON.stringify(publicKeyJwk)).digest("hex").slice(0,16);
  const enrollment=await api(db,"/v1/enroll","POST",{id,publicKey:publicKeyJwk});
  assert.equal(enrollment.status,202,JSON.stringify(enrollment));
  assert.equal(enrollment.body.fingerprint,fingerprint);
  assert.equal((await api(db,"/v1/status?id="+id)).body.status,"pending");
  // Admin approval is through privileged D1 only; there is no HTTP approval path.
  const admin=await api(db,"/v1/approve","POST",{id});
  assert.equal(admin.status,404);
  const row=db.devices.get(id);
  row.status="approved";row.approved_at=Math.floor(Date.now()/1000);
  assert.equal((await api(db,"/v1/status?id="+id)).body.status,"approved");
  const report={
    kind:"windows-readonly-v1",windows:"Windows 11 Pro",
    processor:"AMD Ryzen",cpuCores:8,ramGb:63.9,
    virtualization:{monitor:true,firmware:false,slat:true},
    disks:[{drive:"C:",freeGb:370.7,sizeGb:1000}],
    nodeVersion:"v24.21.0"
  };
  const timestamp=Math.floor(Date.now()/1000),nonce=randomBytes(16).toString("hex");
  const sha=createHash("sha256").update(JSON.stringify(report)).digest("hex");
  const canonical=[id,timestamp,nonce,sha].join("\n");
  const signature=sign("sha256",Buffer.from(canonical),{key:privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url");
  const payload={id,timestamp,nonce,signature,report};
  const accepted=await api(db,"/v1/report","POST",payload);
  assert.equal(accepted.status,201,JSON.stringify(accepted));
  assert.equal(db.reports.size,1);
  assert.equal((await api(db,"/v1/report","POST",payload)).status,409,"replay must fail");
  assert.equal((await api(db,"/v1/reports")).status,404,"public read must fail");
});
