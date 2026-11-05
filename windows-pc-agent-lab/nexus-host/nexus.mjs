#!/usr/bin/env node
/**
 * NEXUS one-window launcher: local MCP server + Cloudflare quick tunnel + registration with nexus-gateway.
 * Config: %USERPROFILE%\.nexus-host\gateway.json  {"url":"https://nexus-gateway.<sub>.workers.dev"}
 * 0.6.1 (04.11 fix): the tunnel heals itself — cloudflared exiting no longer stops the Host (restart with backoff,
 * new URL re-registered); repeated QUIC timeouts on a flaky network switch cloudflared to HTTP/2 (TCP 443, persisted
 * in tunnel-protocol). A killed/crashed Host is restarted by nexus-supervisor.mjs (and the Host restarts a dead
 * supervisor). Fully OFF = live_control host_off / «Выключить NEXUS» on /live (marker host-off); starting the
 * NEXUS-Host-Run task by hand clears it. STOP (sticky, owner-stop.json) is unaffected by restarts.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadConfig, createServer, printCapabilities, audit} from './server.mjs';
import {VERSION} from './catalog.mjs';
import {ensureSupervisor, pidAlive} from './nexus-supervisor.mjs';

const TUNNEL_RE = /https:\/\/[a-z0-9-]{3,80}\.trycloudflare\.com/;
const TUNNEL_EVENT_RE = /(Registered tunnel connection|Unregistered tunnel connection|Connection .* (?:lost|terminated)|Retrying|ERR |error|failed|Lost connection|Initiating graceful shutdown)/i;
export const sanitize = s => String(s).replace(/https?:\/\/\S+/g, '<url>').replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<ip>').replace(/\[[0-9a-f:]+\](?::\d+)?/gi, '<ip>').slice(0, 300);

export function findCloudflared(env = process.env, exists = fs.existsSync) {
  const candidates = [
    env.NEXUS_CLOUDFLARED,
    env['ProgramFiles(x86)'] && path.win32.join(env['ProgramFiles(x86)'], 'cloudflared', 'cloudflared.exe'),
    env.ProgramFiles && path.win32.join(env.ProgramFiles, 'cloudflared', 'cloudflared.exe'),
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
  ].filter(Boolean);
  return candidates.find(p => exists(p)) || null;
}

export function loadGateway(home) {
  const file = path.join(home, 'gateway.json');
  if (!fs.existsSync(file)) throw Error('gateway_json_missing');
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof g.url !== 'string' || !/^https:\/\/[a-z0-9.-]+\.workers\.dev$/.test(g.url)) throw Error('invalid_gateway_url');
  return g.url;
}

export async function registerTunnel(gateway, token, tunnelUrl, {fetcher = fetch, method = 'POST'} = {}) {
  const r = await fetcher(gateway + '/tunnel', {
    method, headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'},
    body: method === 'POST' ? JSON.stringify({url: tunnelUrl}) : undefined,
  });
  if (!r.ok) throw Error('gateway_' + r.status);
  return true;
}

/** Pure: QUIC trouble in the last 15 min (cloudflared lines) → switch to HTTP/2 after 4 such events. */
export const QUIC_TROUBLE_RE = /(no recent network activity|failed to dial to edge with quic|failed to accept QUIC stream|datagram manager error)/i;
export function shouldUseHttp2(events, now = Date.now()) {
  return events.filter(e => e.kind === 'cloudflared' && now - Date.parse(e.t) < 15 * 60_000 && QUIC_TROUBLE_RE.test(e.msg)).length >= 4;
}
export const tunnelBackoffMs = n => Math.min(60_000, 2000 * 2 ** Math.min(n, 5));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const gateway = loadGateway(cfg.home);
  const exe = findCloudflared();
  if (!exe) { console.error('BLOCKED: cloudflared.exe not found. Install: winget install --id Cloudflare.cloudflared'); process.exit(2); }
  fs.mkdirSync(cfg.workspace, {recursive: true});
  const supervised = process.env.NEXUS_SUPERVISED === '1';
  const offFile = path.join(cfg.home, 'host-off');
  if (!supervised && fs.existsSync(offFile)) { fs.rmSync(offFile, {force: true}); } // started by the owner → NEXUS is on again
  cfg.ownerPub = async () => { const r = await fetch(gateway + '/owner-pub', {signal: AbortSignal.timeout(8000)}); if (!r.ok) throw Error('owner_pub_' + r.status); return (await r.json()).x; };
  cfg.onHostOff = () => stop(0);
  const server = createServer(cfg);
  await new Promise((r, j) => { server.once('error', j); server.listen(cfg.port, '127.0.0.1', r); });
  fs.writeFileSync(path.join(cfg.home, 'host.pid'), JSON.stringify({pid: process.pid, startedAt: new Date().toISOString(), supervised}));
  console.log(`NEXUS Host ${VERSION} — ACTIVE on 127.0.0.1:${cfg.port}${supervised ? ' (started by the supervisor)' : ''}`);
  // 0.6.1 install fix: start / migration are audited on this (production) path too
  audit(cfg, {event: 'start', version: VERSION, supervised});
  if (cfg.capsMigrated) audit(cfg, {event: 'capabilities_migrated', to: 'available_by_default', ...cfg.capsMigrated});
  printCapabilities(cfg);

  // 0.4.2 diagnostics: tunnel lifecycle events (sanitised — no URLs, no IPs) in memory (host_diagnostics) and tunnel.log.
  const state = cfg.tunnelState = {registeredAt: null, registrations: 0, cloudflaredPid: null, alive: false, events: [], protocol: 'quic', restarts: 0};
  const logFile = path.join(cfg.home, 'tunnel.log');
  const note = (kind, msg = '') => {
    const e = {t: new Date().toISOString(), kind, msg: sanitize(msg)};
    state.events.push(e); if (state.events.length > 200) state.events.shift();
    try { if (fs.existsSync(logFile) && fs.statSync(logFile).size > 512 * 1024) fs.renameSync(logFile, logFile + '.1'); fs.appendFileSync(logFile, JSON.stringify(e) + '\n'); } catch { /* diagnostics must never break the host */ }
  };
  const protoFile = path.join(cfg.home, 'tunnel-protocol');
  try { if (fs.readFileSync(protoFile, 'utf8').trim() === 'http2') state.protocol = 'http2'; } catch { /* default quic */ }
  let tunnel = null, tunnelUrl = null, stopping = false, fails = 0;
  const register = async why => {
    for (let i = 1; i <= 5 && !stopping; i++) {
      try { await registerTunnel(gateway, cfg.token, tunnelUrl); state.registeredAt = new Date().toISOString(); state.registrations++; note('registered', why); return true; }
      catch (e) { note('register_failed', `${why} attempt ${i}: ${e.message}`); await new Promise(r => setTimeout(r, 3000 * i)); }
    }
    return false;
  };
  function startTunnel() {
    if (stopping) return;
    const args = ['tunnel', '--no-autoupdate', ...(state.protocol === 'http2' ? ['--protocol', 'http2'] : []), '--url', `http://127.0.0.1:${cfg.port}`];
    const t = tunnel = spawn(exe, args, {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
    state.cloudflaredPid = t.pid; state.alive = true; tunnelUrl = null;
    note('tunnel_start', state.protocol);
    let registered = false, switched = false;
    const onOutput = async chunk => {
      const text = String(chunk);
      for (const line of text.split(/\r?\n/)) if (TUNNEL_EVENT_RE.test(line)) note('cloudflared', line);
      // flaky UDP (USB Wi-Fi, 04.11: 95 QUIC timeouts since 01.11) → HTTP/2 over TCP, remembered across restarts
      if (!switched && state.protocol === 'quic' && shouldUseHttp2(state.events)) {
        switched = true; state.protocol = 'http2'; try { fs.writeFileSync(protoFile, 'http2'); } catch {}
        note('tunnel_protocol', 'quic unstable -> http2'); t.kill(); return;
      }
      const m = TUNNEL_RE.exec(text);
      if (!m || registered) return;
      registered = true; tunnelUrl = m[0]; fails = 0;
      if (await register(state.restarts ? 'tunnel_restart' : 'startup')) console.log(`Tunnel registered with gateway (${new URL(gateway).host}). ChatGPT access: ON`);
      else { note('register_giveup', 'restarting tunnel'); t.kill(); }
    };
    t.stdout.on('data', onOutput); t.stderr.on('data', onOutput);
    t.on('exit', code => {
      if (t !== tunnel) return;
      state.alive = false; note('cloudflared_exit', String(code));
      if (stopping) return;
      // 0.6.1: the Host stays up; the tunnel comes back with a new URL (the gateway learns it on registration)
      const wait = switched ? 500 : tunnelBackoffMs(fails++);
      state.restarts++; note('tunnel_restart_scheduled', `${Math.round(wait / 1000)}s`);
      setTimeout(startTunnel, wait).unref?.();
    });
  }
  startTunnel();
  // Idempotent re-registration every 10 min: heals a lost/overwritten gateway entry without restart.
  setInterval(() => { if (tunnelUrl && !stopping) register('refresh'); }, 10 * 60_000).unref();
  // The Host keeps its supervisor alive (and the supervisor keeps the Host alive).
  const sup = () => { if (stopping || fs.existsSync(offFile)) return; try { const r = ensureSupervisor({home: cfg.home, port: cfg.port}); if (r.started) note('supervisor_started', 'launcher ' + r.launcherPid); } catch (e) { note('supervisor_failed', e.message); } };
  setTimeout(sup, 5000).unref(); setInterval(sup, 60_000).unref();

  async function stop(code = 0) {
    if (stopping) return; stopping = true;
    console.log('Stopping: unregistering tunnel…');
    try { await registerTunnel(gateway, cfg.token, null, {method: 'DELETE'}); } catch { /* best effort */ }
    tunnel?.kill(); server.close(); cfg.runtime?.stop();
    try { const p = JSON.parse(fs.readFileSync(path.join(cfg.home, 'host.pid'), 'utf8')); if (p.pid === process.pid) fs.rmSync(path.join(cfg.home, 'host.pid'), {force: true}); } catch {}
    setTimeout(() => process.exit(code), 500).unref();
  }
  process.on('SIGINT', () => stop(0)); process.on('SIGTERM', () => stop(0));
  // 0.5.2 diagnostics: every exit Node can see is written to tunnel.log; NO host_exit after the last event = the
  // process was killed from outside (window closed, taskkill, logoff) — the supervisor then restarts it.
  const fatal = kind => err => { note(kind, String(err?.stack || err).slice(0, 1500)); console.error(`NEXUS Host ${kind}:`, err); stop(1); setTimeout(() => process.exit(1), 3000).unref(); };
  process.on('uncaughtException', fatal('uncaught_exception')); process.on('unhandledRejection', fatal('unhandled_rejection'));
  process.on('exit', code => note('host_exit', String(code)));
  console.log('STOP: the STOP button on /live or «стоп» in chat. Fully off: «Выключить NEXUS» on /live. Closing this window = crash: NEXUS restarts itself within a minute.');
  void pidAlive;
}
