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
import {listWindows} from './windows.mjs';
import {TOOLS, VERSION, PROTOCOL_VERSIONS} from './catalog.mjs';
import {loadCapabilities, validateCapabilities, DEFAULT_CAPABILITIES} from './capabilities.mjs';
import {createGui} from './gui.mjs';
import {createProcs} from './procs.mjs';
import {createBrowser} from './browser.mjs';
import {searchFiles, fileAction} from './files.mjs';
import {createCapStore} from './capstore.mjs';
import {createConsent} from './consent.mjs';
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
  const {file: capabilitiesFile, caps} = env.NEXUS_CAPABILITIES_JSON
    ? {file: null, caps: validateCapabilities(JSON.parse(env.NEXUS_CAPABILITIES_JSON))}
    : loadCapabilities(home);
  return {
    home, token, tokenFile, access, caps, capabilitiesFile,
    port: Number(env.NEXUS_PORT || 8765),
    workspace: env.NEXUS_WORKSPACE || path.join(os.homedir(), 'NEXUS-workspace'),
    auditFile: path.join(home, 'audit.log'),
    allowedOrigins: (env.NEXUS_ALLOWED_ORIGINS || 'https://chatgpt.com,https://chat.openai.com').split(',').map(s => s.trim()).filter(Boolean),
  };
}


/** One runtime per host process: Java daemon, browser, task table. Tests inject fakes via deps.runtime. */
export function createRuntime(cfg, deps = {}) {
  const {procsDeps: _pd, guiDeps: _gd, browserDeps: _bd, principal: _p, accessVerifier: _v, runtime: _r, ...execDeps} = deps;
  const store = createCapStore({file: cfg.capabilitiesFile || null, initial: cfg.caps || validateCapabilities(DEFAULT_CAPABILITIES), audit: e => audit(cfg, e)});
  store.watch();
  const caps = store.view;
  const consent = createConsent({audit: e => audit(cfg, e)});
  const procs = createProcs({caps, cfg, consent, ...(deps.procsDeps || {})});
  const gui = createGui({caps, home: cfg.home, workspace: cfg.workspace, consent, ...(deps.guiDeps || {})});
  const browser = createBrowser({caps, home: cfg.home, onOwnedPid: pid => procs.registerOwned(pid, 'browser'), ...(deps.browserDeps || {})});
  const ws = {workspace: cfg.workspace};
  const handlers = {
    image_selftest: a => gui.image_selftest(a), capture_screen: a => gui.capture_screen(a), focus_window: a => gui.focus_window(a),
    window_info: a => gui.window_info(a), inspect_ui: a => gui.inspect_ui(a), mouse_action: a => gui.mouse_action(a), keyboard_action: a => gui.keyboard_action(a),
    list_processes: a => procs.list_processes(a), process_action: a => procs.process_action(a), run_task: a => procs.run_task(a),
    task_status: a => procs.task_status(a), task_cancel: a => procs.task_cancel(a), read_audit_log: a => procs.read_audit_log(a),
    search_files: a => searchFiles(a, ws), file_action: a => fileAction(a, ws),
    confirm_action: async a => {
      if (!a || typeof a !== 'object' || Object.keys(a).some(k => !['consentId', 'decision', 'target'].includes(k)) ||
          typeof a.consentId !== 'string' || typeof a.target !== 'string') throw Error('invalid_args');
      const p = consent.take(a.consentId, a.decision, a.target);
      if (a.decision === 'cancel') return {cancelled: true, target: p.target};
      const opts = {consented: p, decision: a.decision};
      const out = p.replay.tool === 'process_action' ? await procs.process_action(p.replay.args, opts) : await gui[p.replay.tool](p.replay.args, opts);
      return {confirmed: true, decision: a.decision, target: p.target, result: out,
        next: a.decision === 'close_discard' ? 'If a save prompt appears, «Don\'t save» is allowed for 60 s.' : 'If a save prompt appears, choose «Save».'};
    },
    host_diagnostics: a => { if (a && Object.keys(a).length) throw Error('invalid_args'); return diagnostics(cfg); },
    get_capabilities: a => { if (a && Object.keys(a).length) throw Error('invalid_args'); return store.status(); },
    set_capability: a => {
      if (!a || typeof a !== 'object' || Object.keys(a).some(k => !['capability', 'enabled'].includes(k))) throw Error('invalid_args');
      return {...store.set(a.capability, a.enabled, 'tool'), note: 'Applied immediately, no restart. Recorded in audit log.'};
    },
    browser_open: a => browser.browser_open(a), browser_snapshot: a => browser.browser_snapshot(a), browser_action: a => browser.browser_action(a),
  };
  // open_app: record windows/tabs that appear as NEXUS-created (Windows 11 Notepad may open a TAB in the owner's window).
  const APP_PROC = {notepad: 'notepad', calculator: 'CalculatorApp'};
  handlers.open_app = async a => {
    const name = APP_PROC[a?.app];
    const before = name ? await gui.snapshotApp(name) : [];
    const out = await executeJob('open_app', a, {workspace: cfg.workspace, ...execDeps});
    if (!name || process.platform !== 'win32') return out;
    let after = before;
    for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 400)); after = await gui.snapshotApp(name); if (JSON.stringify(after) !== JSON.stringify(before)) break; }
    return {...out, createdByNexus: consent.recordCreated(before, after, 'open_app:' + a.app),
      note: 'Only windows/tabs listed in createdByNexus may be closed without asking the owner.'};
  };
  return {caps, store, consent, handlers, gui, procs, browser, stop() { store.stop(); gui.stop(); browser.stop(); procs.stopAll(); }};
}

export function printCapabilities(cfg) {
  cfg.runtime ||= createRuntime(cfg);
  const c = cfg.runtime.store.get();
  const on = ['screen_capture', 'ui_read', 'gui_input', 'process_control', 'run_task', 'browser'].map(k => `${k}=${c[k] ? 'ON' : 'off'}`).join(' ');
  console.log(`Capabilities (${cfg.capabilitiesFile || 'env'}): ${on}`);
  console.log(`Input apps: ${c.inputApps.join(', ') || '-'}; tasks: ${Object.keys(c.tasks).join(', ') || '-'}`);
  console.log('Capabilities are re-read live (no restart needed); gui_input can be switched from chat via set_capability.');
  if (process.platform === 'win32') cfg.runtime.gui.warm();
}

/** 0.4.2: read-only diagnostics for pc_offline analysis — no secrets, no tunnel URL, no screen content. */
export function diagnostics(cfg) {
  const t = cfg.tunnelState || null;
  return {
    version: VERSION, hostPid: process.pid, uptimeSec: Math.round(process.uptime()), now: new Date().toISOString(),
    tunnel: t ? {registeredAt: t.registeredAt || null, registrations: t.registrations || 0, cloudflaredPid: t.cloudflaredPid || null,
      cloudflaredAlive: t.alive ?? null, lastEvents: (t.events || []).slice(-20)} : 'not started by nexus.mjs',
    capabilitiesFileError: cfg.runtime?.store?.status().fileError ?? null,
    pendingConsents: cfg.runtime?.consent?.pendingCount() ?? 0,
  };
}

/** Audit never stores typed text or file content — only their length. */
export function auditArgs(args) {
  if (!args || typeof args !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(args)) out[k] = (k === 'text' || k === 'content') && typeof v === 'string' ? `<${v.length} chars>` : typeof v === 'string' ? v.slice(0, 200) : v;
  return out;
}

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
        instructions: 'Owner-approved access to one Windows PC. File tools are confined to the NEXUS workspace folder. GUI input, process control, tasks and browser are off unless the owner enabled them. Use get_capabilities to see current switches; call set_capability ONLY when the owner explicitly asked in this chat.',
      });
    }
    case 'ping': return rpcResult(id, {});
    case 'tools/list': return rpcResult(id, {tools: TOOLS});
    case 'tools/call': {
      const name = params?.name, args = params?.arguments ?? {};
      if (!TOOLS.some(t => t.name === name)) return rpcError(id, -32602, 'unknown_tool');
      const started = Date.now();
      try {
        const {principal: _p, accessVerifier: _v, runtime: _r, procsDeps: _pd, guiDeps: _gd, browserDeps: _bd, ...execDeps} = deps;
        const rt = deps.runtime || (cfg.runtime ||= createRuntime(cfg, deps));
        rt.store?.refresh('file');
        let out;
        if (name === 'list_windows') out = await listWindows(args, {tmpDir: path.join(cfg.home, 'tmp'), ...execDeps});
        else if (rt.handlers[name]) out = await rt.handlers[name](args);
        else out = await executeJob(name, args, {workspace: cfg.workspace, ...execDeps});
        audit(cfg, {by: deps.principal, tool: name, ok: true, ms: Date.now() - started, args: auditArgs(args)});
        if (out && Array.isArray(out.content) && Object.hasOwn(out, 'structured')) {
          return rpcResult(id, {content: out.content, structuredContent: out.structured, isError: false});
        }
        return rpcResult(id, {content: [{type: 'text', text: JSON.stringify(out)}], structuredContent: out, isError: false});
      } catch (e) {
        const code = e?.code === 'ENOENT' ? 'not_found' : /^[a-z0-9_]+(?:: [\w -]+)?$/.test(e?.message) ? e.message : 'internal_error';
        audit(cfg, {by: deps.principal, tool: name, ok: false, error: code, detail: e?.detail, args: auditArgs(args)});
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
    printCapabilities(cfg);
  });
  const stop = () => { audit(cfg, {event: 'stop'}); cfg.runtime?.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
