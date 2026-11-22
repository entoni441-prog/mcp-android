/**
 * NEXUS Host 0.4.0 — processes, owner-defined tasks, audit log.
 *  list_processes   read-only (tasklist.exe from System32)
 *  process_action   close exact process main window; kill only the verified NEXUS-started process (never an unverified tree)
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

// Identity timestamps are exact .NET UTC ticks (strings, never JS numbers).
const validTicks = s => typeof s === 'string' && /^[1-9][0-9]{15,19}$/.test(s);
const normalizeName = s => typeof s === 'string' ? s.trim().replace(/\.exe$/i,'').toLowerCase() : '';
export function processIdentity(v) {
  if (!v || !int(v.pid,1,2147483647) || !validTicks(v.startTime) || !normalizeName(v.process)) return null;
  return {pid:v.pid,startTime:v.startTime,process:normalizeName(v.process)};
}
export function sameProcessIdentity(a,b) {
  const x=processIdentity(a), y=processIdentity(b);
  return !!x && !!y && x.pid===y.pid && x.startTime===y.startTime && x.process===y.process;
}
// Only internally spawned child objects qualify. Retained child handles are
// used for task cancellation, not a newly looked-up PID. A PID alone is never ownership.
const liveChild = c => !!c && typeof c.once==='function' && typeof c.kill==='function' &&
  int(c.pid,1,2147483647) && c.exitCode===null && c.signalCode===null && !c.killed;

// Fixed PowerShell script. No request-controlled commands or paths. Mutation
// opens and holds the process handle, checks StartTime on that same Process
// object, then calls the object method; no subsequent taskkill /pid or /t.
// CloseMainWindow is only a polite main-window request, not a guarantee of exit.
export function lifetimeScript(pid, action='read', expected=null) {
  if (!int(pid,1,2147483647) || !['read','close','kill'].includes(action) ||
      (action!=='read' && (!processIdentity(expected) || expected.pid!==pid))) bad();
  const body = action==='read' ? "$result=@{pid=$p.Id;startTime=$ticks;process=$p.ProcessName}" :
    `if ($p.HasExited -or $ticks -ne '${expected.startTime}') { $result=@{status='identity_changed';requested=$false} }
    else { ${action==='kill' ? "$p.Kill(); $result=@{status='requested';requested=$true}" :
        "$sent=$p.CloseMainWindow(); $result=@{status='requested';requested=[bool]$sent}"} }`;
  return `$ErrorActionPreference='Stop'
$p=$null
try {
  $p=[System.Diagnostics.Process]::GetProcessById(${pid})
  ${action==='read'?'':'$handle=$p.Handle; if ($handle -eq [IntPtr]::Zero) { throw "handle_unavailable" }'}
  $ticks=$p.StartTime.ToUniversalTime().Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture)
  ${body}
} catch { $result=@{status='identity_unavailable';requested=$false} }
finally { if ($null -ne $p) { $p.Dispose() } }
$result | ConvertTo-Json -Compress`;
}

export function createProcs({caps, cfg, platform = process.platform, systemRoot = process.env.SystemRoot, exec = runCapture, spawnFn = spawn, consent = null, audit = () => {}, readIdentity = null, actIdentity = null}) {
  const sys32 = exe => {
    if (typeof systemRoot !== 'string' || !/^[a-zA-Z]:\\/.test(systemRoot)) throw Error('invalid_windows_system_root');
    return path.win32.join(systemRoot, 'System32', exe);
  };
  const owned = new Map();   // pid → {identity, child, label}; never a bare PID
  const tasks = new Map();   // id → task record

  async function listAll() {
    if (platform !== 'win32') throw Error('windows_only');
    const r = await exec(sys32('tasklist.exe'), ['/fo', 'csv', '/nh']);
    if (r.code !== 0) throw Error('tasklist_failed');
    return parseTasklistCsv(r.out);
  }

  async function callLifetime(pid, action='read', expected=null) {
    const r=await exec(sys32('WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile','-NonInteractive','-Command',lifetimeScript(pid,action,expected)]);
    if(r.code!==0) return null;
    try { return JSON.parse(String(r.out).trim()); } catch { return null; }
  }
  async function read(pid) {
    try { const id=processIdentity(await (readIdentity ? readIdentity(pid) : callLifetime(pid)));return id?.pid===pid?id:null; } catch {return null;}
  }
  function forget(pid, record, reason) {
    if (owned.get(pid)!==record) return;
    owned.delete(pid); audit({event:'process_ownership_forgotten',pid,reason});
  }
  function verifyOwned(pid, id) {
    const record=owned.get(pid);
    if (!record) return {owned:false,stale:false};
    const same=liveChild(record.child)&&sameProcessIdentity(record.identity,id);
    if(!same) forget(pid,record,id?'identity_changed':'identity_unavailable');
    return {owned:same,stale:!same,record};
  }
  const api = {
    async registerOwned(child, label) {
      if(platform!=='win32'||!liveChild(child)) return false;
      const pid=child.pid;
      let ended=false;
      const record={child,label,identity:null};
      const endedFn=()=>{ended=true;forget(pid,record,'child_exited');};
      child.once('exit',endedFn); child.once('close',endedFn);
      const id=await read(pid);
      if(ended||!liveChild(child)||!id||owned.has(pid)) {
        audit({event:'process_ownership_refused',pid,reason:'launch_identity_unavailable_or_conflicting'});return false;
      }
      record.identity=id;owned.set(pid,record);return true;
    },

    async list_processes(args) {
      if (!onlyKeys(args, ['nameFilter', 'limit'])) bad();
      if (args.nameFilter !== undefined && (typeof args.nameFilter !== 'string' || args.nameFilter.length > 60)) bad();
      const limit = args.limit ?? 200; if (!int(limit, 1, 500)) bad();
      let all = await listAll();
      if (args.nameFilter) all = all.filter(p => p.process.toLowerCase().includes(args.nameFilter.toLowerCase()));
      all.sort((a, b) => (b.memKB || 0) - (a.memKB || 0));
      const processes=[];
      const present=new Set(all.map(p=>p.pid));
      for(const [pid,rec] of [...owned]) if(!present.has(pid)&&!args.nameFilter) forget(pid,rec,'process_not_found');
      for(const p of all.slice(0,limit)) {
        const id=owned.has(p.pid)?await read(p.pid):null;
        const claimed=verifyOwned(p.pid,id && id.process===normalizeName(p.process)?id:null);
        processes.push({...p,ownedByNexus:claimed.owned});
      }
      return {count:all.length,truncated:all.length>limit,processes};
    },

    async process_action(args, {consented = null} = {}) {
      requireCap(caps, 'process_control');
      if (!onlyKeys(args, ['pid', 'action']) || !int(args.pid, 1, 2 ** 31) || !['close', 'kill'].includes(args.action)) bad();
      const p=(await listAll()).find(x=>x.pid===args.pid);
      if(!p) { const rec=owned.get(args.pid); if(rec)forget(args.pid,rec,'process_not_found');throw Error('process_not_found'); }
      const id=await read(p.pid);
      const checked=verifyOwned(p.pid,id && id.process===normalizeName(p.process)?id:null);
      if(checked.stale) throw Error('process_identity_changed');
      if(!id||id.process!==normalizeName(p.process))throw Error('process_identity_unavailable');
      const pg=appGate(caps,p.process,{mode:'close'});
      if(pg.error==='blocked_by_owner'||(args.action==='kill'?!checked.owned:!(checked.owned||pg.allow||pg.consent)))throw Error('process_not_allowed');
      if(consented && (args.action!=='close'||!sameProcessIdentity(consented.processIdentity,id)))throw Error('consent_target_changed');
      if(args.action==='close'&&!checked.owned&&!consented) {
        if(!consent) throw Error('process_not_allowed');
        const grant=consent.gate({kind:'process',via:'process_action'},{...id,hwnd:'pid:'+p.pid,name:'',process:p.process},null,{tool:'process_action',args});
        if(grant)return grant;
        throw Error('process_consent_unavailable');
      }
      // Re-check ownership immediately before invoking the native guard; a
      // failed or changed identity never falls through to another action.
      if(checked.owned && (owned.get(p.pid)!==checked.record||!liveChild(checked.record.child))) {
        forget(p.pid,checked.record,'child_exited');throw Error('process_identity_changed');
      }
      let result=null;
      try { result=await (actIdentity?actIdentity(id,args.action):callLifetime(p.pid,args.action,id)); } catch {}
      if(!result||result.status!=='requested'||typeof result.requested!=='boolean') {
        if(checked.owned)forget(p.pid,checked.record,result?.status==='identity_changed'?'identity_changed':'identity_unavailable');
        audit({event:'process_action_refused',pid:p.pid,reason:result?.status==='identity_changed'?'identity_changed':'identity_unavailable'});
        throw Error(result?.status==='identity_changed'?'process_identity_changed':'process_identity_unavailable');
      }
      return {pid:p.pid,process:p.process,action:args.action,requested:result.requested,
        note:args.action==='close'?'Main-window close requested; the app may ask to save.':'Only the verified process, not its unverified descendants.'};
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
      child.once('exit', code => {clearTimeout(timer);if(rec.state==='running')rec.state='exited';rec.exitCode=code;rec.endedAt=new Date().toISOString();});
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', () => { clearTimeout(timer); rec.state = 'failed_to_start'; reject(Error('task_launch_failed')); });
      });
      if(rec.state==='running') await api.registerOwned(child,'task:'+args.task);
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
      // Use the retained ChildProcess, not a recycled PID or unverified process tree.
      try { t.child.kill(); } catch { /* already gone */ }
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
        try { t.child.kill(); } catch { /* already gone */ }
        cancelled.push({id: t.id, task: t.task});
      }
      return {cancelled};
    },

    stopAll() { for (const t of tasks.values()) if (t.state === 'running') { try { t.child.kill(); } catch { /* gone */ } } },
  };
  return api;
}
