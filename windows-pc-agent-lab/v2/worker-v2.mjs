/**
 * Windows PC Agent v2 — isolated, user-authorized, read-only telemetry protocol.
 * No commands, no public report reads, no remote shell, no browser access.
 * Administrator enroll/approve/revoke only through authenticated Cloudflare D1 API.
 * This is source for TESTS; not deployed by this repository commit.
 */
const HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"};
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const now=()=>Math.floor(Date.now()/1000);
const idOK=x=>typeof x==="string"&&/^[0-9a-f]{32}$/.test(x);
const b64OK=x=>typeof x==="string"&&/^[A-Za-z0-9_-]{43}$/.test(x);
const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,"0")).join("");
const decode=x=>Uint8Array.from(atob(x.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-x.length%4)%4)),c=>c.charCodeAt(0));
const publicKeyOK=x=>x&&typeof x==="object"&&!Array.isArray(x)&&x.kty==="EC"&&x.crv==="P-256"&&b64OK(x.x)&&b64OK(x.y)&&!("d" in x)&&Object.keys(x).every(k=>["kty","crv","x","y"].includes(k));
const sameKeys=(x,keys)=>x&&typeof x==="object"&&!Array.isArray(x)&&Object.keys(x).sort().join(",")===[...keys].sort().join(",");
const number=(x,max)=>typeof x==="number"&&Number.isFinite(x)&&x>=0&&x<=max;
const metricsOK=x=>sameKeys(x,["kind","nodeVersion","uptimeSec","ramTotalGb","ramFreeGb"])&&x.kind==="windows-readonly-v2"&&typeof x.nodeVersion==="string"&&/^v\d+\.\d+\.\d+$/.test(x.nodeVersion)&&number(x.uptimeSec,1e9)&&number(x.ramTotalGb,2048)&&number(x.ramFreeGb,x.ramTotalGb);
const isFresh=x=>Number.isSafeInteger(x)&&Math.abs(now()-x)<=90;

async function readJson(request,limit=3000){
  if(request.headers.get("content-type")?.split(";")[0]?.toLowerCase()!=="application/json")throw Error("bad_type");
  const length=Number(request.headers.get("content-length"));
  if(length>limit)throw Error("oversize");
  const raw=await request.text();
  if(raw.length>limit)throw Error("oversize");
  const parsed=JSON.parse(raw);
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error("bad_object");
  return parsed;
}

async function verifySigned(route,body,publicJwk){
  if(!isFresh(body.timestamp)||!idOK(body.id)||!idOK(body.nonce)||
     typeof body.signature!=="string"||!/^[A-Za-z0-9_-]{86}$/.test(body.signature))return false;
  // Signing commits to every field (not just hand-picked parameters), route and method.
  const {signature,...payload}=body;
  const canonical=["pc-agent-v2","POST",route,JSON.stringify(payload)].join("\n");
  try{
    const key=await crypto.subtle.importKey("jwk",JSON.parse(publicJwk),{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
    return await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},key,decode(signature),new TextEncoder().encode(canonical));
  }catch{return false;}
}

export default {
  async fetch(request,env){
    const route=new URL(request.url).pathname;
    try{
      if(request.method==="GET"&&route==="/health")
        return reply({status:"ready",component:"pc-agent-v2-lab",execution:"forbidden"});
      if(request.method!=="POST"||!["/v2/enroll","/v2/status","/v2/heartbeat"].includes(route))
        return reply({error:"not_found"},404);
      const x=await readJson(request);
      if(route==="/v2/enroll"){
        if(!sameKeys(x,["id","publicKey"])||!idOK(x.id)||!publicKeyOK(x.publicKey))return reply({error:"invalid_enrollment"},400);
        const jwk={kty:"EC",crv:"P-256",x:x.publicKey.x,y:x.publicKey.y};
        try{await crypto.subtle.importKey("jwk",jwk,{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);}
        catch{return reply({error:"invalid_key"},400);}
        const gate=await env.DB.prepare("SELECT expires_at FROM v2_enrollment_gate WHERE name='windows-v2'").first();
        if(!gate||gate.expires_at<=now())return reply({error:"enrollment_closed"},403);
        const pending=await env.DB.prepare("SELECT COUNT(*) AS n FROM v2_devices WHERE status='pending' AND created_at>?").bind(now()-900).first();
        if((pending?.n??0)>=5)return reply({error:"pending_limit"},429);
        const fingerprint=hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(jwk)))).slice(0,16);
        await env.DB.prepare("INSERT OR IGNORE INTO v2_devices(id,public_jwk,fingerprint,status,created_at,last_seq) VALUES(?,?,?,'pending',?,0)").bind(x.id,JSON.stringify(jwk),fingerprint,now()).run();
        const row=await env.DB.prepare("SELECT fingerprint,status FROM v2_devices WHERE id=?").bind(x.id).first();
        if(row?.fingerprint!==fingerprint||row?.status!=="pending")return reply({error:"enrollment_conflict"},409);
        return reply({status:"pending",fingerprint},202);
      }
      if(!idOK(x.id))return reply({error:"invalid_request"},400);
      const device=await env.DB.prepare("SELECT public_jwk,status,created_at,last_seq FROM v2_devices WHERE id=?").bind(x.id).first();
      if(!device)return reply({error:"unrecognized"},404);
      if(route==="/v2/status"){
        if(!sameKeys(x,["id","timestamp","nonce","signature"])||!await verifySigned(route,x,device.public_jwk))return reply({error:"invalid_signature"},403);
        if(device.status==="pending"&&now()-device.created_at>900)return reply({status:"expired"});
        return reply({status:device.status,lastSeq:device.status==="approved"?device.last_seq:0});
      }
      if(!sameKeys(x,["id","timestamp","nonce","seq","metrics","signature"])||
         !Number.isSafeInteger(x.seq)||x.seq<1||!metricsOK(x.metrics))return reply({error:"invalid_heartbeat"},400);
      if(device.status!=="approved")return reply({error:"not_approved"},403);
      if(!await verifySigned(route,x,device.public_jwk))return reply({error:"invalid_signature"},403);
      // Single atomic update prevents duplicate/replayed signed sequence numbers.
      const changed=await env.DB.prepare("UPDATE v2_devices SET last_seq=?,last_seen_at=?,last_metrics_json=? WHERE id=? AND status='approved' AND last_seq<? RETURNING id")
        .bind(x.seq,now(),JSON.stringify(x.metrics),x.id,x.seq).first();
      if(!changed)return reply({error:"stale_or_revoked"},409);
      return reply({status:"accepted",seq:x.seq},201);
    }catch(e){
      if(e instanceof SyntaxError||["bad_type","bad_object","oversize"].includes(e.message))return reply({error:"invalid_json"},400);
      return reply({error:"internal_error"},500);
    }
  }
};
