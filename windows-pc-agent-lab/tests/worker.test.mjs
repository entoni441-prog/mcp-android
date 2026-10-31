import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.mjs";

const makeDB=()=>({
  reads:0,writes:0,
  prepare(sql){
    const db=this;
    return {
      bind(){return this;},
      async first(){
        db.reads++;
        if(sql.includes("enrollment_gate")) return null;
        return null;
      },
      async run(){db.writes++;return {success:true};}
    };
  }
});
const invoke=(url,method="GET",body=null,db=makeDB()) =>
  worker.fetch(new Request(url,{method,headers:body?{"content-type":"application/json"}:undefined,
    body:body?JSON.stringify(body):undefined}),{DB:db});

test("health is safe and confirms no command execution",async()=>{
  const r=await invoke("https://example.workers.dev/health");
  assert.equal(r.status,200);
  const x=await r.json();
  assert.equal(x.execution,"forbidden");
  assert.match(r.headers.get("cache-control"),/no-store/);
});
test("unknown remote-command and report-read routes remain inaccessible",async()=>{
  for(const path of ["/v1/exec","/v1/commands","/v1/reports","/v1/admin","/"]) {
    const r=await invoke("https://example.workers.dev"+path);
    assert.equal(r.status,404,path);
  }
});
test("closed enrollment blocks unsolicited key registration",async()=>{
  const db=makeDB();
  const x={id:"0123456789abcdef0123456789abcdef",
    publicKey:{kty:"EC",crv:"P-256",x:"A".repeat(43),y:"B".repeat(43)}};
  // The gate cannot open without explicit admin D1 query.
  const r=await invoke("https://example.workers.dev/v1/enroll","POST",x,db);
  assert.ok([400,403].includes(r.status));
  assert.equal(db.writes,0);
});
test("unapproved/incomplete report never reaches D1",async()=>{
  const db=makeDB();
  const r=await invoke("https://example.workers.dev/v1/report","POST",{id:"f".repeat(32)},db);
  assert.equal(r.status,400);
  assert.equal(db.reads,0);
  assert.equal(db.writes,0);
});
test("reject malformed device status lookup",async()=>{
  const db=makeDB();
  const r=await invoke("https://example.workers.dev/v1/status?id=hello","GET",null,db);
  assert.equal(r.status,400);
  assert.equal(db.reads,0);
});
