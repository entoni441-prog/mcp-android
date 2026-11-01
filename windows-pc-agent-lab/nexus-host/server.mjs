#!/usr/bin/env node
/**
 * NEXUS Host — local MCP server (Streamable HTTP, JSON responses) for the owner's Windows PC.
 * Zero npm dependencies: runs on the signed node.exe, nothing to install, no .cmd/.ps1 wrapper.
 *
 * Security model:
 *  - listens on 127.0.0.1 only; reachable from outside only through an outbound tunnel the owner starts;
 *  - every request needs `Authorization: Bearer <token>`; token is generated locally on first run;
 *  - Origin header, if present, must be in the allowlist (DNS-rebinding protection);
 *  - tools are a fixed set; file tools are confined to one workspace folder (reuses audited v3/actions.mjs);
 *  - no shell, no arbitrary command execution; every call is appended to a local audit log;
 *  - STOP = close the window / Ctrl+C. Nothing auto-starts.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {executeJob} from '../v3/actions.mjs';

const VERSION = '0.2.0';
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 64 * 1024;

export function loadConfig(env = process.env) {
  const home = env.NEXUS_HOME || path.join(os.homedir(), '.nexus-host');
  fs.mkdirSync(home, {recursive: true});
  const tokenFile = path.join(home, 'token.txt');
  let token = env.NEXUS_TOKEN;
  if (!token) {
    if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(32).toString('base64url'), {mode: 0o600, flag: 'wx'});
    token = fs.readFileSync(tokenFile, 'utf8').trim();
  }
  if (token.length < 32) throw Error('token_too_short');
  // Optional Cloudflare Access mode: %USERPROFILE%\.nexus-host\access.json
  // {"teamDomain":"<team>.cloudflareaccess.com","aud":"<application AUD tag>","allowedEmails":["owner@example.com"]}
  let access = null;
  const accessFile = path.join(home, 'access.json');
  if (fs.existsSync(accessFile)) {
    const a = JSON.parse(fs.readFileSync(accessFile, 'utf8'));
    if (typeof a.teamDomain !== 'string' || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(a.teamDomain) ||
        typeof a.aud !== 'string' || !/^[a-f0-9]{64}$/.test(a.aud) ||
        !Array.isArray(a.allowedEmails) || a.allowedEmails.length < 1 || !a.allowedEmails.every(e => typeof e === 'string' && e.includes('@'))) {
      throw Error('invalid_access_json');
    }
    access = {teamDomain: a.teamDomain, aud: a.aud, allowedEmails: a.allowedEmails.map(e => e.toLowerCase())};
  }
  return {
    home, token, tokenFile, access,
    port: Number(env.NEXUS_PORT || 8765),
    workspace: env.NEXUS_WORKSPACE || path.join(os.homedir(), 'NEXUS-workspace'),
    auditFile: path.join(home, 'audit.log'),
    allowedOrigins: (env.NEXUS_ALLOWED_ORIGINS || 'https://chatgpt.com,https://chat.openai.com').split(',').map(s => s.trim()).filter(Boolean),
  };
}

const str = (description) => ({type: 'string', description});
const TOOLS = [
  {name: 'get_status', description: 'Host status: OS, uptime, memory.', inputSchema: {type: 'object', properties: {}, additionalProperties: false}, annotations: {readOnlyHint: true}},
  {name: 'list_dir', description: 'List a folder inside the NEXUS workspace. path="" is the workspace root; use "/" separators.', inputSchema: {type: 'object', properties: {path: str('Relative path')}, required: ['path'], additionalProperties: false}, annotations: {readOnlyHint: true}},
  {name: 'read_text', description: 'Read a small UTF-8 text file (≤8 KiB) inside the workspace. Returns text and sha256.', inputSchema: {type: 'object', properties: {path: str('Relative path')}, required: ['path'], additionalProperties: false}, annotations: {readOnlyHint: true}},
  {name: 'make_dir', description: 'Create one folder inside the workspace.', inputSchema: {type: 'object', properties: {path: str('Relative path')}, required: ['path'], additionalProperties: false}},
  {name: 'write_text', description: 'Create (expectedSha256=null) or replace (expectedSha256=current sha256) a small text file inside the workspace.', inputSchema: {type: 'object', properties: {path: str('Relative path'), content: str('UTF-8 text ≤8 KiB'), expectedSha256: {type: ['string', 'null']}}, required: ['path', 'content', 'expectedSha256'], additionalProperties: false}},
  {name: 'open_app', description: 'Open an allowlisted Windows app on the owner\'s desktop.', inputSchema: {type: 'object', properties: {app: {type: 'string', enum: ['notepad', 'calculator']}}, required: ['app'], additionalProperties: false}},
];

function audit(cfg, entry) {
  try { fs.appendFileSync(cfg.auditFile, JSON.stringify({t: new Date().toISOString(), ...entry}) + '\n'); } catch { /* audit must not crash host */ }
}

const rpcResult = (id, result) => ({jsonrpc: '2.0', id, result});
const rpcError = (id, code, message) => ({jsonrpc: '2.0', id: id ?? null, error: {code, message}});

export async function handleRpc(msg, cfg, deps = {}) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'invalid_request');
  const isNotification = !Object.hasOwn(msg, 'id');
  if (isNotification) return null;
  const {id, method, params = {}} = msg;
  switch (method) {
    case 'initialize': {
      const requested = params.protocolVersion;
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: {tools: {listChanged: false}},
        serverInfo: {name: 'nexus-host', version: VERSION},
        instructions: 'Owner-approved access to one Windows PC. File tools are confined to the NEXUS workspace folder.',
      });
    }
    case 'ping': return rpcResult(id, {});
    case 'tools/list': return rpcResult(id, {tools: TOOLS});
    case 'tools/call': {
      const name = params?.name, args = params?.arguments ?? {};
      if (!TOOLS.some(t => t.name === name)) return rpcError(id, -32602, 'unknown_tool');
      const started = Date.now();
      try {
        const {principal: _p, accessVerifier: _v, ...execDeps} = deps;
        const out = await executeJob(name, args, {workspace: cfg.workspace, ...execDeps});
        audit(cfg, {by: deps.principal, tool: name, ok: true, ms: Date.now() - started, path: args?.path, app: args?.app});
        return rpcResult(id, {content: [{type: 'text', text: JSON.stringify(out)}], structuredContent: out, isError: false});
      } catch (e) {
        const code = /^[a-z_]+$/.test(e?.message) ? e.message : 'internal_error';
        audit(cfg, {by: deps.principal, tool: name, ok: false, error: code, path: args?.path, app: args?.app});
        return rpcResult(id, {content: [{type: 'text', text: `error: ${code}`}], isError: true});
      }
    }
    default: return rpcError(id, -32601, 'method_not_found');
  }
}

function tokenOk(header, token) {
  const m = /^Bearer (\S+)$/.exec(header || '');
  if (!m) return false;
  const a = crypto.createHash('sha256').update(m[1]).digest();
  const b = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(a, b);
}

const b64urlJson = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/** Verifies a Cloudflare Access JWT (RS256) against the team's published keys. Returns the email or null. */
export function createAccessVerifier(access, {fetcher = fetch, now = () => Date.now()} = {}) {
  let keys = new Map(), fetchedAt = 0;
  async function refresh() {
    if (now() - fetchedAt < 60_000 && keys.size) return;
    const r = await fetcher(`https://${access.teamDomain}/cdn-cgi/access/certs`);
    if (!r.ok) throw Error('jwks_unavailable');
    const body = await r.json();
    const next = new Map();
    for (const jwk of body.keys || []) if (jwk.kty === 'RSA' && typeof jwk.kid === 'string') next.set(jwk.kid, crypto.createPublicKey({key: jwk, format: 'jwk'}));
    keys = next; fetchedAt = now();
  }
  return async function verify(jwt) {
    if (typeof jwt !== 'string' || jwt.length > 8192) return null;
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    let header, claims;
    try { header = b64urlJson(parts[0]); claims = b64urlJson(parts[1]); } catch { return null; }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
    if (!keys.has(header.kid)) { try { await refresh(); } catch { return null; } }
    const key = keys.get(header.kid);
    if (!key) return null;
    const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'));
    if (!ok) return null;
    const t = Math.floor(now() / 1000);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== `https://${access.teamDomain}` || !aud.includes(access.aud)) return null;
    if (!Number.isFinite(claims.exp) || claims.exp <= t || (Number.isFinite(claims.nbf) && claims.nbf > t + 60)) return null;
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    return access.allowedEmails.includes(email) ? email : null;
  };
}

function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store', ...headers});
  res.end(data);
}

export function createServer(cfg, deps = {}) {
  const verifyAccess = cfg.access ? (deps.accessVerifier || createAccessVerifier(cfg.access)) : null;
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/mcp') return send(res, 404, {error: 'not_found'});
    const origin = req.headers.origin;
    if (origin && !cfg.allowedOrigins.includes(origin)) { audit(cfg, {denied: 'origin', origin}); return send(res, 403, {error: 'origin_denied'}); }
    // Two ways in: local bearer token, or (when access.json exists) a valid Cloudflare Access JWT for an allowed email.
    let principal = tokenOk(req.headers.authorization, cfg.token) ? 'local-token' : null;
    if (!principal && verifyAccess && req.headers['cf-access-jwt-assertion']) {
      const email = await verifyAccess(String(req.headers['cf-access-jwt-assertion']));
      if (email) principal = 'access:' + email;
    }
    if (!principal) { audit(cfg, {denied: 'auth'}); return send(res, 401, {error: 'unauthorized'}, {'www-authenticate': 'Bearer'}); }
    if (req.method === 'GET' || req.method === 'DELETE') return send(res, 405, {error: 'method_not_allowed'}, {allow: 'POST'});
    if (req.method !== 'POST') return send(res, 405, {error: 'method_not_allowed'}, {allow: 'POST'});
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(res, 415, rpcError(null, -32700, 'content_type'));
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { req.destroy(); } else chunks.push(c); });
    req.on('end', async () => {
      let msg;
      try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, rpcError(null, -32700, 'parse_error')); }
      if (Array.isArray(msg)) return send(res, 400, rpcError(null, -32600, 'batch_not_supported'));
      const out = await handleRpc(msg, cfg, {...deps, principal});
      if (out === null) { res.writeHead(202); return res.end(); }
      send(res, 200, out);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  fs.mkdirSync(cfg.workspace, {recursive: true});
  const server = createServer(cfg);
  server.listen(cfg.port, '127.0.0.1', () => {
    console.log(`NEXUS Host ${VERSION} — ACTIVE on http://127.0.0.1:${cfg.port}/mcp`);
    console.log(`Workspace: ${cfg.workspace}`);
    console.log(`Token file: ${cfg.tokenFile}  (never paste it into chats)`);
    console.log('Close this window or press Ctrl+C to STOP all access.');
    audit(cfg, {event: 'start', version: VERSION});
  });
  const stop = () => { audit(cfg, {event: 'stop'}); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
