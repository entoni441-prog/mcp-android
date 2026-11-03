/**
 * NEXUS Host 0.4.0 — processes, owner-defined tasks, audit log.
 *  list_processes   read-only (tasklist.exe from System32)
 *  process_action   close (WM_CLOSE via taskkill /pid) allowlisted apps or NEXUS-started processes; kill only NEXUS-started
 *  run_task etc.    ONLY tasks the owner wrote into capabilities.json (exe + fixed args); no shell, no args from chat
 *  read_audit_log   tail of .nexus-host/audit.log
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {requireCap} from './capabilities.mjs';
import {appGate} from './policy.mjs';

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (a, allowed) => isObj(a) && Object.keys(a).every(k => allowed.includes(k));
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const bad = () => { throw Error('invalid_args'); };
const OUT_MAX = 32 * 1024;

export function parseTasklistCsv(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^"([^"]*)","(\d+)","([^"]*)","(\d+)","([^"]*)"/.exec(line.trim());
    if (!m) continue;
    rows.push({process: m[1].replace(/\.exe$/i, ''), pid: Number(m[2]), session: Number(m[4]), memKB: Number(m[5].replace(/[^\d]/g, '')) || null});
  }
  return rows;
}

function runCapture(exe, args, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
    let out = '';
    const t = setTimeout(() => { p.kill(); reject(Error('timeout')); }, timeoutMs);
    p.stdout.on('data', c => { if (out.length < 4e6) out += c; });
    p.once('error', () => { clearTimeout(t); reject(Error('launch_failed')); });
    p.once('exit', code => { clearTimeout(t); resolve({code, out}); });
  });
}

export function createProcs({caps, cfg, platform = process.platform, systemRoot = process.env.SystemRoot, exec = runCapture, spawnFn = spawn, consent = null}) {
  const sys32 = exe => {
    if (typeof systemRoot !== 'string' || !/^[a-zA-Z]:\\/.test(systemRoot)) throw Error('invalid_windows_system_root');
    return path.win32.join(systemRoot, 'System32', exe);
  };
  const owned = new Map();   // pid → label (tasks; browser registers too)
  const tasks = new Map();   // id → task record

  async function listAll() {
    if (platform !== 'win32') throw Error('windows_only');
    const r = await exec(sys32('tasklist.exe'), ['/fo', 'csv', '/nh']);
    if (r.code !== 0) throw Error('tasklist_failed');
    return parseTasklistCsv(r.out);
  }

  const api = {
    registerOwned(pid, label) { if (Number.isInteger(pid)) owned.set(pid, label); },

    async list_processes(args) {
      if (!onlyKeys(args, ['nameFilter', 'limit'])) bad();
      if (args.nameFilter !== undefined && (typeof args.nameFilter !== 'string' || args.nameFilter.length > 60)) bad();
      const limit = args.limit ?? 200; if (!int(limit, 1, 500)) bad();
      let all = await listAll();
      if (args.nameFilter) all = all.filter(p => p.process.toLowerCase().includes(args.nameFilter.toLowerCase()));
      all.sort((a, b) => (b.memKB || 0) - (a.memKB || 0));
      return {count: all.length, truncated: all.length > limit, processes: all.slice(0, limit).map(p => ({...p, ownedByNexus: owned.has(p.pid)}))};
    },

    async process_action(args, {consented = null} = {}) {
      requireCap(caps, 'process_control');
      if (!onlyKeys(args, ['pid', 'action']) || !int(args.pid, 1, 2 ** 31) || !['close', 'kill'].includes(args.action)) bad();
      const p = (await listAll()).find(x => x.pid === args.pid);
      if (!p) throw Error('process_not_found');
      const isOwned = owned.has(p.pid) || !!consent?.owned.pids.has(p.pid);
      // 0.5.2: any app allowed by policy (a protected app is closable too — closing a non-owned app always asks the owner).
      const pg = appGate(caps, p.process, {mode: 'close'});
      const isAllowedApp = pg.allow || !!pg.consent;
      if (args.action === 'kill' ? !isOwned : !(isOwned || isAllowedApp)) throw Error('process_not_allowed');
      // 0.4.2: closing an allowlisted app NEXUS did not start (it may hold the owner's documents) needs owner consent.
      if (args.action === 'close' && !isOwned && consent) {
        if (consented) { if (String(consented.pid) !== String(p.pid)) throw Error('consent_target_changed'); }
        else {
          const g = consent.gate({kind: 'process', via: 'process_action'}, {process: p.process, pid: p.pid, hwnd: 'pid:' + p.pid, name: ''}, null, {tool: 'process_action', args});
          if (g) return g;
        }
      }
      const r = await exec(sys32('taskkill.exe'), args.action === 'kill' ? ['/pid', String(p.pid), '/t', '/f'] : ['/pid', String(p.pid)]);
      return {pid: p.pid, process: p.process, action: args.action, requested: r.code === 0, note: args.action === 'close' ? 'Close request sent; the app may ask to save.' : undefined};
    },

    async run_task(args) {
      requireCap(caps, 'run_task');
      if (!onlyKeys(args, ['task']) || typeof args.task !== 'string') bad();
      const def = caps.tasks[args.task];
      if (!def) throw Error('unknown_task');
      if ([...tasks.values()].filter(t => t.state === 'running').length >= (caps.limits?.maxTasks ?? 3)) throw Error('too_many_tasks');
      if (!fs.existsSync(def.exe)) throw Error('task_exe_missing');
      const id = crypto.randomBytes(6).toString('hex');
      const cwd = def.cwd || cfg.workspace;
      const rec = {id, task: args.task, state: 'running', startedAt: new Date().toISOString(), exitCode: null, out: ''};
      const child = spawnFn(def.exe, def.args, {cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
      rec.child = child;
      const add = c => { rec.out += c; if (rec.out.length > OUT_MAX) rec.out = rec.out.slice(-OUT_MAX); };
      child.stdout?.setEncoding?.('utf8'); child.stderr?.setEncoding?.('utf8');
      child.stdout?.on('data', add); child.stderr?.on('data', add);
      const timer = setTimeout(() => { rec.state = 'timeout'; child.kill(); }, def.timeoutSec * 1000);
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', () => { clearTimeout(timer); rec.state = 'failed_to_start'; reject(Error('task_launch_failed')); });
      });
      if (child.pid) owned.set(child.pid, 'task:' + args.task);
      child.once('exit', code => { clearTimeout(timer); if (rec.state === 'running') rec.state = 'exited'; rec.exitCode = code; rec.endedAt = new Date().toISOString(); owned.delete(child.pid); });
      tasks.set(id, rec);
      if (tasks.size > 20) tasks.delete(tasks.keys().next().value);
      return {id, task: args.task, state: rec.state, pid: child.pid};
    },

    async task_status(args) {
      requireCap(caps, 'run_task');
      if (!onlyKeys(args, ['id'])) bad();
      if (args.id === undefined) return {tasks: [...tasks.values()].map(t => ({id: t.id, task: t.task, state: t.state, exitCode: t.exitCode}))
        , available: Object.keys(caps.tasks)};
      const t = tasks.get(args.id); if (!t) throw Error('unknown_task_id');
      return {id: t.id, task: t.task, state: t.state, exitCode: t.exitCode, startedAt: t.startedAt, endedAt: t.endedAt || null, outputTail: t.out.slice(-8192)};
    },

    async task_cancel(args) {
      requireCap(caps, 'run_task');
      if (!onlyKeys(args, ['id']) || typeof args.id !== 'string') bad();
      const t = tasks.get(args.id); if (!t) throw Error('unknown_task_id');
      if (t.state !== 'running') return {id: t.id, state: t.state};
      t.state = 'cancelled';
      if (platform === 'win32' && t.child.pid) await exec(sys32('taskkill.exe'), ['/pid', String(t.child.pid), '/t', '/f']).catch(() => {});
      else t.child.kill();
      return {id: t.id, state: t.state};
    },

    async read_audit_log(args) {
      if (!onlyKeys(args, ['lines'])) bad();
      const n = args.lines ?? 50; if (!int(n, 1, 200)) bad();
      if (!fs.existsSync(cfg.auditFile)) return {entries: []};
      const fd = fs.openSync(cfg.auditFile, 'r');
      try {
        const size = fs.fstatSync(fd).size, len = Math.min(size, 256 * 1024);
        const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len);
        const lines = buf.toString('utf8').split('\n').filter(Boolean);
        if (size > len) lines.shift();
        return {entries: lines.slice(-n).map(l => { try { return JSON.parse(l); } catch { return {raw: l.slice(0, 300)}; } })};
      } finally { fs.closeSync(fd); }
    },

    /** 0.5.1: session ended (finish_task / Stop / idle / revoke) → cancel tasks NEXUS started during that session. */
    async cancelSession(reason, sess) {
      const since = sess?.startedAt ?? 0;
      const cancelled = [];
      for (const t of tasks.values()) {
        if (t.state !== 'running' || Date.parse(t.startedAt) < since - 1000) continue;
        t.state = 'cancelled'; t.cancelReason = reason;
        if (platform === 'win32' && t.child.pid) await exec(sys32('taskkill.exe'), ['/pid', String(t.child.pid), '/t', '/f']).catch(() => {});
        else { try { t.child.kill(); } catch { /* gone */ } }
        cancelled.push({id: t.id, task: t.task});
      }
      return {cancelled};
    },

    stopAll() { for (const t of tasks.values()) if (t.state === 'running') { try { t.child.kill(); } catch { /* gone */ } } },
  };
  return api;
}
