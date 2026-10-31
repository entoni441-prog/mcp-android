// Antigravity Bridge v0.2: Ed25519-signed, read-only probe only.
// Pairing is closed by default and approved through Cloudflare D1 management.
const json = (obj, code = 200) => new Response(JSON.stringify(obj), {
  status: code, headers: {"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}
});
const enc = new TextEncoder();
const hex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
const digest = async b => hex(new Uint8Array(await crypto.subtle.digest("SHA-256",b)));
function decode(s) {
  if(typeof s!=="string" || s.length>512 || !/^[a-zA-Z0-9_-]+$/.test(s)) throw Error("bad_base64");
  const padded=s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4);
  return Uint8Array.from(atob(padded),ch=>ch.charCodeAt(0));
}
async function identity(req,env,raw) {
  const id=req.headers.get("x-agy-agent-id")||"",ts=req.headers.get("x-agy-timestamp")||"",
  nonce=req.headers.get("x-agy-nonce")||"",sig=req.headers.get("x-agy-signature")||"";
  if(!/^[0-9a-f]{64}$/.test(id)||!(/^[0-9]{10}$/.test(ts))|| !/^[a-zA-Z0-9_-]{22,48}$/.test(nonce)) return null;
  if(Math.abs(Math.floor(Date.now()/1000)-Number(ts))>120) return null;
  const row=await env.DB.prepare("SELECT public_key FROM agents WHERE id=? AND status='approved'").bind(id).first();
  if(!row) return null;
  try {
    const key=await crypto.subtle.importKey("spki",decode(row.public_key),{name:"Ed25519"},false,["verify"]);
    const canonical=[req.method,new URL(req.url).pathname,ts,nonce,await digest(enc.encode(raw))].join("\n");
    const ok=await crypto.subtle.verify("Ed25519",key,decode(sig),enc.encode(canonical));
    if(!ok) return null;
    await env.DB.prepare("DELETE FROM nonces WHERE created_at < unixepoch()-600").run();
    const stored=await env.DB.prepare("INSERT OR IGNORE INTO nonces(agent_id,nonce) VALUES(?,?)").bind(id,nonce).run();
    return stored.meta?.changes===1?id:null;
  }catch{return null}
}
async function enroll(env,raw) {
  if(raw.length>1000) return json({error:"too_large"},413);
  const window=await env.DB.prepare("SELECT enroll_until FROM bridge_config WHERE id=1").first();
  if(!window||Number(window.enroll_until)<Math.floor(Date.now()/1000)) return json({error:"enrollment_closed"},403);
  const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM agents WHERE status='pending' AND created_at>unixepoch()-3600").first();
  if((count?.n||0)>=5) return json({error:"enrollment_capacity_reached"},429);
  let body;try{body=JSON.parse(raw)}catch{return json({error:"bad_json"},400)}
  if(typeof body?.public_key!=="string"||body.public_key.length>180) return json({error:"bad_key"},400);
  let der;try{
    der=decode(body.public_key);
    if(der.length<40||der.length>100) throw Error("key_size");
    await crypto.subtle.importKey("spki",der,{name:"Ed25519"},false,["verify"]);
  }catch{return json({error:"invalid_key"},400)}
  const id=await digest(der);
  await env.DB.prepare("INSERT OR IGNORE INTO agents(id,public_key,status) VALUES (?,?,'pending')").bind(id,body.public_key).run();
  const state=await env.DB.prepare("SELECT status FROM agents WHERE id=?").bind(id).first();
  return json({agent_id:id,fingerprint:id.slice(0,16),status:state.status});
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({service:"agy-bridge-mvp",version:"0.2",status:env.DB?"ready":"database_unbound"});
    }
    if(!env.DB) return json({error:"database_unbound"},503);
    if(url.search) return json({error:"query_not_supported"},400);
    if(request.method!=="POST") return json({error:"not_found"},404);
    if(!request.headers.get("content-type")?.startsWith("application/json")) return json({error:"content_type"},415);
    if(Number(request.headers.get("content-length")||0)>8192) return json({error:"too_large"},413);
    const raw=await request.text();
    if(raw.length>8192) return json({error:"too_large"},413);
    try {
      if (url.pathname==="/v1/agent/enroll") return await enroll(env,raw);
      const agentId=await identity(request,env,raw);
      if (!agentId) return json({error:"unauthorized"},401);
      if (url.pathname === "/v1/agent/claim") {
        await env.DB.prepare("UPDATE jobs SET status='queued',agent_id=NULL,lease_until=NULL,updated_at=unixepoch() WHERE status='running' AND kind='probe' AND lease_until < unixepoch()").run();
        const row = await env.DB.prepare("UPDATE jobs SET status='running',agent_id=?,claimed_at=unixepoch(),lease_until=unixepoch()+180,updated_at=unixepoch() WHERE id=(SELECT id FROM jobs WHERE status='queued' AND kind='probe' ORDER BY created_at LIMIT 1) AND status='queued' RETURNING id,kind").bind(agentId).first();
        return json({job:row || null});
      }
      const match = url.pathname.match(/^\/v1\/agent\/jobs\/([a-zA-Z0-9_-]{8,80})\/finish$/);
      if (match) {
        let payload;try{payload=JSON.parse(raw)}catch{return json({error:"bad_json"},400)}
        if (!["success","error"].includes(payload?.status)) return json({error:"bad_status"},400);
        const response=typeof payload.response==="string"?payload.response:"";
        const error=typeof payload.error==="string"?payload.error:"";
        if(response.length>4000||error.length>500) return json({error:"too_large"},413);
        const usage=payload.usage===undefined?null:JSON.stringify(payload.usage);
        if(usage&&usage.length>2000) return json({error:"too_large"},413);
        const result=await env.DB.prepare("UPDATE jobs SET status=?,response=?,error=?,usage_json=?,lease_until=NULL,updated_at=unixepoch() WHERE id=? AND status='running' AND agent_id=? AND lease_until>unixepoch()").bind(payload.status,response,error,usage,match[1],agentId).run();
        return json({accepted:result.meta?.changes===1});
      }
      return json({error:"not_found"},404);
    }catch{return json({error:"internal_error"},500)}
  }
};
