#!/usr/bin/env node
/**
 * NEXUS 0.6.1 supervisor (fix 04.11.2026: the Host was killed from outside and nothing brought it back → HTTP 530).
 *
 *   node nexus-supervisor.mjs            start the daemon if none is alive (logon task / the Host itself), then exit
 *   node nexus-supervisor.mjs --daemon   the loop: every 20 s GET /healthz; 2 misses in a row → kill a hung Host
 *                                        (its pid from host.pid) and start `node nexus.mjs` hidden (NEXUS_SUPERVISED=1)
 *
 * Rules: never runs while %USERPROFILE%\.nexus-host\host-off exists (the owner turned NEXUS off); restarts back off
 * 30 s → 1 → 2 → 5 min and reset after 10 min of health; one daemon at a time (supervisor.pid); every action is a
 * line in tunnel.log (kind "supervisor"). The owner's sticky STOP lives in owner-stop.json and survives restarts.
 * Detached + windowsHide: no console window appears. Nothing here needs administrator rights.
 *
 * 0.6.1c (install 05.11, C.5): on Windows a `detached` child still records its creator as ParentProcessId, so
 * `taskkill /pid <host> /t /f` killed the supervisor too (and vice versa) → nothing left to restart. Every start now goes
 * through a short-lived launcher (`--spawn`): it starts the real process and exits at once, so the two are never in
 * one PID tree and a tree kill of one leaves the other alive.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const pidAlive = pid => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
export const restartBackoffMs = n => [30_000, 60_000, 120_000, 300_000][Math.min(n, 3)];

/** Start the daemon unless one is alive. Returns {started, pid}. */
export function ensureSupervisor({home, port = 8765, spawnFn = spawn, node = process.execPath} = {}) {
  const cur = readJson(path.join(home, 'supervisor.pid'));
  if (cur && pidAlive(cur.pid)) return {started: false, pid: cur.pid};
  if (fs.existsSync(path.join(home, 'host-off'))) return {started: false, off: true};
  const launcher = launchDetached({script: 'nexus-supervisor.mjs', args: ['--daemon'], env: {NEXUS_HOME: home, NEXUS_PORT: String(port)}, spawnFn, node});
  return {started: true, launcherPid: launcher};
}

/** The only scripts the launcher may start (it is not a general-purpose runner). */
export const LAUNCHABLE = Object.freeze(['nexus.mjs', 'nexus-supervisor.mjs']);
/**
 * Start `node <script> ...args` with NO parent link to the caller: a launcher process starts it and exits immediately
 * (the grandchild's ParentProcessId then points to a dead process, outside the caller's tree). Returns the launcher pid.
 */
export function launchDetached({script, args = [], env = {}, out = null, node = process.execPath, spawnFn = spawn}) {
  if (!LAUNCHABLE.includes(script)) throw Error('not_launchable');
  const spec = Buffer.from(JSON.stringify({script, args, env, out})).toString('base64url');
  const c = spawnFn(node, [path.join(HERE, 'nexus-supervisor.mjs'), '--spawn', spec], {detached: true, windowsHide: true, stdio: 'ignore', env: {...process.env}});
  c.unref?.();
  return c.pid;
}
/** Launcher body: validate the spec, start the grandchild detached + hidden, exit. Returns the grandchild pid. */
export function runSpawnSpec(specB64, {spawnFn = spawn, node = process.execPath} = {}) {
  const spec = JSON.parse(Buffer.from(String(specB64), 'base64url').toString('utf8'));
  if (!LAUNCHABLE.includes(spec.script) || !Array.isArray(spec.args) || !spec.args.every(a => typeof a === 'string')) throw Error('bad_spec');
  const env = {...process.env};
  for (const [k, v] of Object.entries(spec.env || {})) if (/^NEXUS_[A-Z_]+$/.test(k) && typeof v === 'string') env[k] = v;
  let stdio = 'ignore';
  if (typeof spec.out === 'string' && path.basename(spec.out) === 'host-console.log') { const fd = fs.openSync(spec.out, 'a'); stdio = ['ignore', fd, fd]; }
  const c = spawnFn(node, [path.join(HERE, spec.script), ...spec.args], {cwd: HERE, detached: true, windowsHide: true, stdio, env});
  c.unref?.();
  return c.pid;
}

/** One supervision step (pure apart from the injected effects) — exported for tests. */
export async function superviseStep(st, {home, healthy, startHost, killPid, now = Date.now(), note = () => {}}) {
  if (fs.existsSync(path.join(home, 'host-off'))) { st.misses = 0; return 'off'; }
  if (await healthy()) {
    st.misses = 0;
    if (st.lastRestart && now - st.lastRestart > 10 * 60_000) st.restarts = 0;
    return 'ok';
  }
  st.misses = (st.misses || 0) + 1;
  if (st.misses < 2) return 'miss';
  if (st.lastRestart && now - st.lastRestart < restartBackoffMs(Math.max(0, (st.restarts || 0) - 1))) return 'backoff';
  const hp = readJson(path.join(home, 'host.pid'));
  if (hp && pidAlive(hp.pid)) { note('supervisor', `host pid ${hp.pid} not answering - killing it`); killPid(hp.pid); }
  st.restarts = (st.restarts || 0) + 1; st.lastRestart = now; st.misses = 0;
  note('supervisor', `starting host (restart ${st.restarts})`);
  startHost();
  return 'restarted';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const home = process.env.NEXUS_HOME || path.join(os.homedir(), '.nexus-host');
  const port = Number(process.env.NEXUS_PORT || 8765);
  fs.mkdirSync(home, {recursive: true});
  const log = path.join(home, 'tunnel.log');
  const note = (kind, msg) => { try { fs.appendFileSync(log, JSON.stringify({t: new Date().toISOString(), kind, msg: String(msg).slice(0, 300)}) + '\n'); } catch {} };
  if (process.argv[2] === '--spawn') { try { runSpawnSpec(process.argv[3]); } catch (e) { note('supervisor', 'launcher: ' + e.message); process.exit(1); } process.exit(0); }
  if (!process.argv.includes('--daemon')) {
    const r = ensureSupervisor({home, port});
    console.log(r.started ? `NEXUS supervisor started (pid ${r.pid}).` : r.off ? 'NEXUS is turned off (host-off) - supervisor not started.' : `NEXUS supervisor already running (pid ${r.pid}).`);
    process.exit(0);
  }
  const pidFile = path.join(home, 'supervisor.pid');
  const cur = readJson(pidFile);
  if (cur && cur.pid !== process.pid && pidAlive(cur.pid)) process.exit(0); // another daemon won the race
  fs.writeFileSync(pidFile, JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}));
  note('supervisor', `daemon up (pid ${process.pid})`);
  const healthy = async () => { try { const r = await fetch(`http://127.0.0.1:${port}/healthz`, {signal: AbortSignal.timeout(5000)}); return r.ok; } catch { return false; } };
  const startHost = () => launchDetached({script: 'nexus.mjs', env: {NEXUS_SUPERVISED: '1'}, out: path.join(home, 'host-console.log')});
  const killPid = pid => {
    if (process.platform === 'win32') spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(pid), '/t', '/f'], {windowsHide: true});
    else { try { process.kill(pid, 'SIGKILL'); } catch {} }
  };
  const st = {};
  const tick = async () => {
    try { await superviseStep(st, {home, healthy, startHost, killPid, note}); } catch (e) { note('supervisor', 'error: ' + e.message); }
    if (fs.existsSync(path.join(home, 'host-off')) && !(await healthy())) { note('supervisor', 'host-off: daemon exits'); try { fs.rmSync(pidFile, {force: true}); } catch {} process.exit(0); }
    setTimeout(tick, 20_000);
  };
  setTimeout(tick, 15_000); // give a just-started Host time to listen
}
