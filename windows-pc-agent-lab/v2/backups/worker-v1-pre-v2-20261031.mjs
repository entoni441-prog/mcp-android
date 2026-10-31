/**
 * PC Agent Laboratory — isolated, enrollment-gated diagnostic inbox.
 *
 * NO remote command execution. NO public report retrieval.
 * Approval is ONLY via privileged Cloudflare D1 API (not an HTTP route).
 * The device reports harmless fixed-schema capabilities only after approval.
 */
const HEADERS = {
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "x-content-type-options":"nosniff"
};
const respond = (value,status=200) => new Response(JSON.stringify(value),{status,headers:HEADERS});
const now = () => Math.floor(Date.now()/1000);
const idOK = x => typeof x==="string" && /^[0-9a-f]{32}$/.test(x);
const b64urlOK = x => typeof x==="string" && /^[A-Za-z0-9_-]{42,44}$/.test(x);
const textOK = (x,n) => typeof x==="string" && x.length>0 && x.length<=n;
const numOK = (x,max) => typeof x==="number" && Number.isFinite(x) && x>=0 && x<=max;
const hex = data => Array.from(new Uint8Array(data),x=>x.toString(16).padStart(2,"0")).join("");
const bytes = x => Uint8Array.from(atob(x.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-x.length%4)%4)),c=>c.charCodeAt(0));
async function digest(value) {return hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));}
function publicJwk(x) {
  return x && typeof x==="object" && x.kty==="EC" && x.crv==="P-256" &&
    b64urlOK(x.x) && b64urlOK(x.y) && !("d" in x) &&
    Object.keys(x).every(k=>["kty","crv","x","y","key_ops","ext"].includes(k));
}
function reportOK(r) {
  if (!r || typeof r!=="object" || Array.isArray(r)) return false;
  if (Object.keys(r).sort().join(",")!=="cpuCores,disks,kind,nodeVersion,processor,ramGb,virtualization,windows") return false;
  if (r.kind!=="windows-readonly-v1" || !textOK(r.windows,110) ||
      !textOK(r.processor,110) || !textOK(r.nodeVersion,25) ||
      !numOK(r.ramGb,2048) || !numOK(r.cpuCores,256)) return false;
  const v=r.virtualization;
  if (!v || typeof v!=="object" ||
      !["firmware","monitor","slat"].every(k=>typeof v[k]==="boolean")) return false;
  if (!Array.isArray(r.disks) || r.disks.length>12) return false;
  return r.disks.every(d=>d && typeof d==="object" &&
    typeof d.drive==="string" && /^[A-Z]:$/.test(d.drive) &&
    numOK(d.freeGb,1000000) && numOK(d.sizeGb,1000000));
}
async function parseBody(request,limit=5000) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw Error("invalid_type");
  if (Number(request.headers.get("content-length"))>limit) throw Error("too_large");
  const body=await request.text();
  if (body.length>limit) throw Error("too_large");
  return JSON.parse(body);
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    try {
      if (request.method==="GET" && url.pathname==="/health")
        return respond({status:"ready",component:"pc-agent-readonly-lab",execution:"forbidden"});
      if (request.method==="POST" && url.pathname==="/v1/enroll") {
        const x=await parseBody(request,1800);
        if (!idOK(x.id) || !publicJwk(x.publicKey)) return respond({error:"invalid_enrollment"},400);
        const jwk={kty:"EC",crv:"P-256",x:x.publicKey.x,y:x.publicKey.y};
        // Verify that the public key is a real curve point.
        try {await crypto.subtle.importKey("jwk",jwk,{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);}
        catch {return respond({error:"invalid_key"},400);}
        const fingerprint=(await digest(JSON.stringify(jwk))).slice(0,16);
        const gate=await env.DB.prepare("SELECT expires_at FROM enrollment_gate WHERE name='windows-v1'").first();
        if (!gate || gate.expires_at<now()) return respond({error:"enrollment_closed"},403);
        const pending=await env.DB.prepare("SELECT COUNT(*) AS n FROM devices WHERE status='pending' AND created_at>?").bind(now()-900).first();
        if ((pending?.n??0)>=5) return respond({error:"pending_limit"},429);
        await env.DB.prepare("INSERT OR IGNORE INTO devices(id,public_jwk,fingerprint,status,created_at) VALUES(?,?,?,'pending',?)")
          .bind(x.id,JSON.stringify(jwk),fingerprint,now()).run();
        const row=await env.DB.prepare("SELECT fingerprint,status FROM devices WHERE id=?").bind(x.id).first();
        if(row.fingerprint!==fingerprint) return respond({error:"id_collision"},409);
        return respond({status:row.status,fingerprint},202);
      }
      if (request.method==="GET" && url.pathname==="/v1/status") {
        const id=url.searchParams.get("id");
        if (!idOK(id)) return respond({error:"invalid_device"},400);
        const row=await env.DB.prepare("SELECT status,created_at,approved_at FROM devices WHERE id=?").bind(id).first();
        if (!row) return respond({status:"unknown"},404);
        if(row.status==="pending" && now()-row.created_at>900) return respond({status:"expired"});
        if(row.status==="approved" && now()-row.approved_at>3600) return respond({status:"expired"});
        return respond({status:row.status});
      }
      if (request.method==="POST" && url.pathname==="/v1/report") {
        const x=await parseBody(request,5500);
        if (!idOK(x.id) || !Number.isSafeInteger(x.timestamp) || Math.abs(now()-x.timestamp)>90 ||
            !idOK(x.nonce) || typeof x.signature!=="string" ||
            !/^[a-zA-Z0-9_-]{85,88}$/.test(x.signature) ||
            !reportOK(x.report)) return respond({error:"invalid_report"},400);
        const row=await env.DB.prepare("SELECT public_jwk,status,approved_at FROM devices WHERE id=?").bind(x.id).first();
        if (!row || row.status!=="approved" || now()-row.approved_at>3600)
          return respond({error:"not_approved"},403);
        const payload=JSON.stringify(x.report);
        if(payload.length>4000) return respond({error:"too_large"},413);
        const canonical=[x.id,x.timestamp,x.nonce,await digest(payload)].join("\n");
        const key=await crypto.subtle.importKey("jwk",JSON.parse(row.public_jwk),
          {name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
        const ok=await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},
          key,bytes(x.signature),new TextEncoder().encode(canonical));
        if(!ok) return respond({error:"invalid_signature"},403);
        // Only one signed diagnostic report per enrollment.
        const prior=await env.DB.prepare("SELECT 1 AS n FROM reports WHERE device_id=?").bind(x.id).first();
        if (prior) return respond({error:"already_reported"},409);
        await env.DB.prepare("INSERT INTO reports(device_id,received_at,report_json) VALUES(?,?,?)")
          .bind(x.id,now(),payload).run();
        return respond({status:"accepted",report:"windows-readonly-v1"},201);
      }
      return respond({error:"not_found"},404);
    } catch (e) {
      if (e instanceof SyntaxError || ["invalid_type","too_large"].includes(e.message))
        return respond({error:"invalid_json"},400);
      // No stack traces or D1 details to untrusted clients.
      return respond({error:"internal_error"},500);
    }
  }
};
