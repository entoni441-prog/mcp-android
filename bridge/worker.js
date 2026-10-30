// AGY Bridge MVP: one safe probe task; no arbitrary user prompts or shell commands.
// Bind an ISOLATED D1 database as DB and secret AGY_BRIDGE_AGENT_TOKEN.
const json = (obj, code = 200) => new Response(JSON.stringify(obj), {
  status: code, headers: {"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}
});
async function authorized(req, env) {
  const configured = env.AGY_BRIDGE_AGENT_TOKEN;
  const supplied = req.headers.get("authorization") || "";
  if (!configured || configured.length < 32 || supplied.length > 300 || !supplied.startsWith("Bearer ")) return false;
  // Compare fixed-size SHA-256 digests without early termination.
  const encode = new TextEncoder();
  const [wanted, received] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode.encode(configured)),
    crypto.subtle.digest("SHA-256", encode.encode(supplied.slice(7))),
  ]);
  const a = new Uint8Array(wanted), b = new Uint8Array(received);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({service:"agy-bridge",version:"0.1.0",status:env.DB && env.AGY_BRIDGE_AGENT_TOKEN ? "configured" : "unconfigured"});
    }
    if (!await authorized(request, env)) return json({error:"unauthorized"},401);
    if (!env.DB) return json({error:"database_unbound"},503);
    try {
      if (request.method === "POST" && url.pathname === "/v1/agent/claim") {
        const payload = await request.json().catch(()=>({}));
        const agentId = payload.agent_id;
        if (typeof agentId !== "string" || !/^[a-zA-Z0-9_.-]{1,64}$/.test(agentId)) return json({error:"bad_agent_id"},400);
        // Safe to requeue expired probes: each probe is idempotent and read-only.
        await env.DB.prepare("UPDATE jobs SET status='queued',agent_id=NULL,lease_until=NULL,updated_at=unixepoch() WHERE status='running' AND kind='probe' AND lease_until < unixepoch()").run();
        const row = await env.DB.prepare(
          "UPDATE jobs SET status='running',agent_id=?,claimed_at=unixepoch(),lease_until=unixepoch()+180,updated_at=unixepoch() WHERE id=(SELECT id FROM jobs WHERE status='queued' AND kind='probe' ORDER BY created_at LIMIT 1) AND status='queued' RETURNING id,kind"
        ).bind(agentId).first();
        return json({job:row || null});
      }
      const match = url.pathname.match(/^\/v1\/agent\/jobs\/([a-zA-Z0-9_-]{8,80})\/finish$/);
      if (request.method === "POST" && match) {
        const payload = await request.json().catch(()=>({}));
        const agentId = payload.agent_id;
        if (typeof agentId !== "string" || !/^[a-zA-Z0-9_.-]{1,64}$/.test(agentId)) return json({error:"bad_agent_id"},400);
        if (!["success","error"].includes(payload.status)) return json({error:"bad_status"},400);
        const response = typeof payload.response === "string" ? payload.response : "";
        const error = typeof payload.error === "string" ? payload.error : "";
        if (response.length > 4000 || error.length > 500) return json({error:"payload_too_large"},413);
        const usage = payload.usage === undefined ? null : JSON.stringify(payload.usage);
        if (usage && usage.length > 2000) return json({error:"usage_too_large"},413);
        const result = await env.DB.prepare(
          "UPDATE jobs SET status=?, response=?,error=?,usage_json=?,lease_until=NULL,updated_at=unixepoch() WHERE id=? AND status='running' AND agent_id=?"
        ).bind(payload.status,response,error,usage,match[1],agentId).run();
        return json({accepted:(result.meta?.changes ?? 0) === 1});
      }
      return json({error:"not_found"},404);
    } catch (error) {
      // Never log stack traces, query contents, tokens, or payloads publicly.
      return json({error:"internal_error"},500);
    }
  }
};
