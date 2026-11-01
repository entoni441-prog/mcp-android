#!/usr/bin/env node
/**
 * NEXUS one-window launcher: local MCP server + Cloudflare quick tunnel + registration with nexus-gateway.
 * Config: %USERPROFILE%\.nexus-host\gateway.json  {"url":"https://nexus-gateway.<sub>.workers.dev"}
 * STOP = Ctrl+C or close the window: tunnel is unregistered and closed, nothing keeps running.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadConfig, createServer, printCapabilities} from './server.mjs';

const TUNNEL_RE = /https:\/\/[a-z0-9-]{3,80}\.trycloudflare\.com/;

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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const gateway = loadGateway(cfg.home);
  const exe = findCloudflared();
  if (!exe) { console.error('BLOCKED: cloudflared.exe not found. Install: winget install --id Cloudflare.cloudflared'); process.exit(2); }
  fs.mkdirSync(cfg.workspace, {recursive: true});
  const server = createServer(cfg);
  await new Promise(r => server.listen(cfg.port, '127.0.0.1', r));
  console.log(`NEXUS Host — ACTIVE on 127.0.0.1:${cfg.port}`);
  printCapabilities(cfg);

  const tunnel = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${cfg.port}`], {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
  let registered = false, stopping = false;
  const onOutput = async chunk => {
    const m = TUNNEL_RE.exec(String(chunk));
    if (!m || registered) return;
    registered = true;
    for (let i = 1; i <= 5; i++) {
      try { await registerTunnel(gateway, cfg.token, m[0]); console.log(`Tunnel registered with gateway (${new URL(gateway).host}). ChatGPT access: ON`); return; }
      catch (e) { console.error(`register attempt ${i} failed: ${e.message}`); await new Promise(r => setTimeout(r, 3000 * i)); }
    }
    console.error('BLOCKED: gateway registration failed; stopping.'); stop(1);
  };
  tunnel.stdout.on('data', onOutput); tunnel.stderr.on('data', onOutput);
  tunnel.on('exit', code => { if (!stopping) { console.error(`cloudflared exited (${code}); stopping.`); stop(1); } });

  async function stop(code = 0) {
    if (stopping) return; stopping = true;
    console.log('Stopping: unregistering tunnel…');
    try { await registerTunnel(gateway, cfg.token, null, {method: 'DELETE'}); } catch { /* best effort */ }
    tunnel.kill(); server.close(); cfg.runtime?.stop();
    setTimeout(() => process.exit(code), 500).unref();
  }
  process.on('SIGINT', () => stop(0)); process.on('SIGTERM', () => stop(0));
  console.log('Close this window or press Ctrl+C to STOP all access.');
}
