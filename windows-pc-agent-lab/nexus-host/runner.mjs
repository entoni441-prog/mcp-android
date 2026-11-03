/**
 * NEXUS NEXT — command runner (FR-03.2, architecture §4.1) and owner-approved command plans.
 *
 * A command is ALWAYS `exe` + argument array (spawn with shell:false). No shell string is ever built by NEXUS.
 * Classes (decided by classifyCommand — pure, unit-tested):
 *   R0  read-only diagnostics (git status, winget list, ipconfig, schtasks /query …)          → autonomous
 *   R1  ordinary work in the workspace / owner task roots (git commit, npm test, tar …)       → autonomous, audited
 *   R2  software change of a named package (winget install --id X) / git push                → autonomous only when the
 *       package is in the owner's allowedPackages; otherwise consent for exactly that command
 *   R3  anything else (scripts, unknown programs, system changes)                             → consent for the EXACT
 *       command text (full exe, args, cwd), or a step of an owner-approved plan with the same hash
 *   deny  encoded/obfuscated commands, download-and-execute, disabling Defender/UAC/SAC/BitLocker/firewall, credential
 *       stores and dumps, boot/disk destruction → refused under any consent (the owner does it himself).
 * Honest boundary: a process started as the owner has the owner's rights; the class is decided by WHAT IS ASKED, so
 * R3 means «the owner saw exactly this text», not «NEXUS proved it harmless».
 *
 * STOP / owner pause / finish_task / client cancel kill running commands (tree). A lease end (view_idle) does not:
 * a long build may run while the model thinks. Output: stdout/stderr tails (secrets redacted), exit code, duration.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn as nodeSpawn, execFile} from 'node:child_process';
import {requireCap} from './capabilities.mjs';
import {redactSecrets} from './policy.mjs';

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (a, allowed) => isObj(a) && Object.keys(a).every(k => allowed.includes(k));
const bad = (why = '') => { throw Error('invalid_args' + (why ? ': ' + why : '')); };
const base = exe => path.win32.basename(String(exe)).toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, '');
const lc = a => a.map(x => String(x).toLowerCase());

/** Refused whatever the consent says (architecture §4.1 «Запрет»). Tested against exe + joined args. */
export const DENY_RULES = Object.freeze([
  [/^(powershell|pwsh|powershell_ise)\b[\s\S]*\s[-\/](e|ec|en|enc|enco|encod|encode|encoded|encodedc|encodedco|encodedcom|encodedcomm|encodedcomma|encodedcomman|encodedcommand)(\s|$)/i, 'encoded_command'],
  [/frombase64string|\[convert\]::from/i, 'encoded_command'],
  [/\b(iex|invoke-expression)\b[\s\S]*\b(iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring|downloadfile|net\.webclient|curl|wget|start-bitstransfer)\b|\b(iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring|net\.webclient)\b[\s\S]*\|\s*(iex|invoke-expression)\b/i, 'download_and_execute'],
  [/\b(set|add)-mppreference\b|disablerealtimemonitoring|disableantispyware|\bexclusionpath\b|\bmpcmdrun\b[\s\S]*-removedefinitions/i, 'defender_change'],
  [/\benablelua\b|consentpromptbehavior|promptonsecuredesktop|\bfilteradministratortoken\b/i, 'uac_change'],
  [/\bverifiedandreputablepolicystate\b|smartappcontrol|\bci\\policy\b/i, 'smart_app_control_change'],
  [/\bmanage-bde\b[\s\S]*-(off|disable|protectors\s+-delete)|\b(disable|suspend)-bitlocker\b/i, 'bitlocker_change'],
  [/\badvfirewall\b[\s\S]*\bstate\s+off\b|\bset-netfirewallprofile\b[\s\S]*-enabled\s+(false|0)|\bfirewall\s+set\s+opmode\s+disable/i, 'firewall_change'],
  [/\bvaultcmd\b|\bcmdkey\b|\bmimikatz\b|\bntdsutil\b|\breg(\.exe)?\s+save\s+hklm\\(sam|security|system)\b|comsvcs[\s\S]*minidump|\bprocdump\b[\s\S]*lsass|\bget-credential\b|\bexport-pfxcertificate\b/i, 'credential_access'],
  [/\b(bcdedit|diskpart|format|cipher\s+\/w|vssadmin\s+delete|wbadmin\s+delete|wevtutil\s+cl|fsutil\s+(file\s+setzerodata|usn\s+deletejournal))\b/i, 'boot_or_disk_destruction'],
  [/\bautoadminlogon\b|\bdefaultpassword\b|\bnetplwiz\b|\buserpasswords2\b|disablecad\b/i, 'autologon_or_logon_change'],
]);
const DENY_EXE = new Set(['bw', 'bitwarden', 'keepass', 'keepassxc', '1password', 'op', 'lastpass', 'lpass', 'dashlane', 'keeper', 'mimikatz', 'psexec', 'psexec64', 'mshta', 'wscript', 'cscript', 'regsvr32', 'rundll32', 'certutil', 'bitsadmin']);

/** R0 table: exe → predicate over lower-cased args (read-only subcommands only). */
const R0 = {
  git: a => ['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'blame', 'describe', 'shortlog', 'reflog', '--version'].includes(a[0]) || (a[0] === 'branch' && a.length <= 2 && !a.some(x => /^-[dDmMcC]$|--delete|--move|--copy/.test(x))) || (a[0] === 'remote' && (a[1] === '-v' || a.length === 1)) || (a[0] === 'stash' && a[1] === 'list') || (a[0] === 'config' && (a.includes('--get') || a.includes('--list') || a.includes('-l'))),
  node: a => a.length === 1 && ['--version', '-v'].includes(a[0]),
  npm: a => ['-v', '--version', 'ls', 'list', 'view', 'outdated', 'config'].includes(a[0]) && !(a[0] === 'config' && a[1] !== 'list' && a[1] !== 'get'),
  winget: a => ['list', 'search', 'show', '--version', '--info'].includes(a[0]),
  where: () => true, whoami: a => !a.some(x => /\/(priv|all)/i.test(x)), hostname: () => true, ver: () => true,
  ipconfig: a => a.length === 0 || a.every(x => ['/all', '/displaydns'].includes(x)),
  ping: () => true, nslookup: () => true, tracert: () => true, pathping: () => true, getmac: () => true, route: a => a[0] === 'print', arp: a => a[0] === '-a',
  netstat: () => true, systeminfo: () => true, tasklist: () => true, driverquery: () => true,
  powercfg: a => ['/a', '/availablesleepstates', '/q', '/query', '/l', '/list', '/getactivescheme', '/lastwake', '/devicequery', '/waketimers', '/requests'].includes(a[0]),
  schtasks: a => a[0] === '/query', sc: a => ['query', 'queryex', 'qc', 'qdescription', 'qfailure'].includes(a[0]),
  netsh: a => a.includes('show') && !a.some(x => ['set', 'add', 'delete', 'reset', 'dump'].includes(x)),
  reg: a => a[0] === 'query', adb: a => ['devices', 'version', 'get-state', 'get-serialno'].includes(a[0]),
  java: a => a.length === 1 && ['-version', '--version'].includes(a[0]), javac: a => a.length === 1 && ['-version', '--version'].includes(a[0]),
  dotnet: a => ['--info', '--version', '--list-sdks', '--list-runtimes'].includes(a[0]), gh: a => ['--version', 'auth'].includes(a[0]) && (a[0] !== 'auth' || a[1] === 'status'),
  cloudflared: a => a.length === 1 && ['--version', 'version'].includes(a[0]), wsl: a => a.length === 1 && ['--status', '--version', '-l', '--list'].includes(a[0]),
};
/** R1 table: ordinary work, confined to the workspace / owner task roots (cwd checked by the runner). */
const R1 = {
  git: a => ['add', 'commit', 'checkout', 'switch', 'fetch', 'pull', 'stash', 'clone', 'init', 'merge', 'rebase', 'tag', 'restore', 'mv', 'rm', 'cherry-pick', 'worktree', 'branch', 'remote', 'config'].includes(a[0])
    && !a.some(x => /^--(exec|upload-pack|receive-pack|config-env)|^-c$|core\.(sshcommand|hookspath|fsmonitor|pager|editor|askpass)|credential\.|^alias\.|filter\.|diff\..*\.(textconv|command)|^--global$|^--system$/.test(x)),
  npm: a => ['ci', 'install', 'i', 'test', 't', 'run', 'run-script', 'build', 'pack', 'init', 'start', 'audit'].includes(a[0]) && !a.includes('-g') && !a.includes('--global'),
  node: a => a.length >= 1 && /\.(m?js|cjs)$/i.test(a[0]) && !path.isAbsolute(a[0]) && !a[0].includes('..') || a[0] === '--test',
  tar: a => !a.some(x => /^--?(to-command|use-compress-program|checkpoint-action|i$|info-script|new-volume-script)/i.test(x)),
  '7z': a => ['a', 'x', 'e', 'l', 't'].includes(a[0]), java: a => a[0] === '-jar' && !path.isAbsolute(a[1] || '') && !String(a[1] || '').includes('..'),
  javac: () => true, dotnet: a => ['build', 'test', 'run', 'restore', 'new', 'clean', 'publish'].includes(a[0]),
  gradle: () => true, gradlew: () => true, mvn: () => true, adb: a => ['pull', 'logcat', 'forward', 'reverse', 'connect', 'disconnect', 'pair'].includes(a[0]),
  ipconfig: a => a.length === 1 && a[0] === '/flushdns', certutil: () => false,
};

/**
 * Pure classifier. → {cls:'R0'|'R1'|'R2'|'R3'|'deny', reason}. `allowedPackages` = owner list of winget ids (R2 autonomous).
 */
export function classifyCommand(exe, args = [], {allowedPackages = []} = {}) {
  if (typeof exe !== 'string' || !exe || exe.length > 400 || exe.includes('\0')) return {cls: 'deny', reason: 'bad_exe'};
  if (!Array.isArray(args) || args.length > 64 || !args.every(a => typeof a === 'string' && a.length <= 4000 && !a.includes('\0'))) return {cls: 'deny', reason: 'bad_args'};
  const b = base(exe), text = [b, ...args].join(' ');
  if (DENY_EXE.has(b)) return {cls: 'deny', reason: 'denied_program:' + b};
  for (const [re, why] of DENY_RULES) if (re.test(text)) return {cls: 'deny', reason: why};
  const a = lc(args);
  if (R0[b]?.(a)) return {cls: 'R0', reason: 'read_only'};
  if (b === 'winget' && ['install', 'uninstall', 'upgrade'].includes(a[0])) {
    const i = a.findIndex(x => x === '--id' || x === '-i'), id = i >= 0 ? args[i + 1] : null;
    if (!id || !a.includes('--exact') && !a.includes('-e')) return {cls: 'R3', reason: 'winget_without_exact_id'};
    if (a.some(x => /--(override|custom|location|ignore-security-hash|force)/.test(x))) return {cls: 'R3', reason: 'winget_unsafe_flag'};
    return {cls: allowedPackages.includes(id) ? 'R1' : 'R2', reason: 'software_change:' + id};
  }
  if (b === 'git' && a[0] === 'push') return a.some(x => /^(-f|--force|--force-with-lease|--delete|-d|--mirror|--prune)$/.test(x) || x.startsWith(':') || x.startsWith('+')) ? {cls: 'R3', reason: 'git_push_rewrites'} : {cls: 'R2', reason: 'git_push'};
  if (R1[b]?.(a)) return {cls: 'R1', reason: 'workspace_work'};
  return {cls: 'R3', reason: R0[b] || R1[b] ? 'subcommand_not_in_profile' : 'program_not_in_profile'};
}

/** Canonical text the owner sees and the plan hash covers. */
export const commandText = (exe, args, cwd) => `${exe} ${args.map(x => (!x || /[^\w.:/\\=@+,-]/.test(x) ? JSON.stringify(x) : x)).join(' ')}`.trim() + (cwd ? `   [папка: ${cwd}]` : '');
export const planHash = (title, steps) => crypto.createHash('sha256').update(JSON.stringify({title, steps: steps.map(s => ({exe: s.exe, args: s.args, cwd: s.cwd ?? null}))})).digest('hex');

/** Resolve a bare program name on PATH (Windows PATHEXT); npm/npx → node.exe + their cli.js (no .cmd, shell:false). */
export function resolveExe(exe, {platform = process.platform, env = process.env, exists = fs.existsSync} = {}) {
  if (path.win32.isAbsolute(exe) || path.posix.isAbsolute(exe)) return exists(exe) ? {file: exe, pre: []} : null;
  if (/[\\/]/.test(exe)) return null;
  const dirs = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const name = exe.replace(/\.exe$/i, '');
  if (['npm', 'npx'].includes(name.toLowerCase())) {
    const nodeDir = path.dirname(process.execPath);
    const cli = path.join(nodeDir, platform === 'win32' ? '' : '../lib', 'node_modules', 'npm', 'bin', name.toLowerCase() + '-cli.js');
    return exists(cli) ? {file: process.execPath, pre: [cli]} : null;
  }
  const exts = platform === 'win32' ? ['.exe', '.com'] : [''];
  for (const d of dirs) for (const e of exts) { const f = path.join(d, name + e); if (exists(f)) return {file: f, pre: []}; }
  return null;
}

export function createRunner({caps, cfg, consent = null, tasks = null, audit = () => {}, spawnFn = nodeSpawn, platform = process.platform,
  resolve = e => resolveExe(e, {platform}), now = () => Date.now(), killTree = null}) {
  const runs = new Map();
  const plansDir = path.join(cfg.home, 'plans');
  const limits = () => ({timeoutSec: caps.limits?.commandTimeoutSec ?? 600, outKB: caps.limits?.maxOutputKB ?? 256, parallel: caps.limits?.maxCommands ?? 3});
  const roots = () => [cfg.workspace, ...(caps.taskRoots || [])].map(r => path.resolve(r));
  const inRoots = p => roots().some(r => { const rel = path.relative(r, path.resolve(p)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); });
  const kill = async rec => {
    if (!rec.child || rec.state !== 'running') return;
    if (killTree) await killTree(rec.child.pid).catch(() => {});
    else if (platform === 'win32' && rec.child.pid) await new Promise(r => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(rec.child.pid), '/t', '/f'], {windowsHide: true}, () => r()));
    else { try { rec.child.kill('SIGKILL'); } catch {} }
  };
  const view = r => ({id: r.id, state: r.state, cls: r.cls, command: r.text, exitCode: r.exitCode, startedAt: r.startedAt, endedAt: r.endedAt || null,
    ms: r.endedAt ? Date.parse(r.endedAt) - Date.parse(r.startedAt) : now() - Date.parse(r.startedAt),
    stdout: redactSecrets(r.out).text.slice(-8192), stderr: redactSecrets(r.err).text.slice(-8192), truncated: r.truncated || false,
    ...(r.cancelReason ? {cancelledBy: r.cancelReason} : {}), ...(r.planId ? {planId: r.planId, step: r.step} : {})});

  function loadPlan(id) { try { return JSON.parse(fs.readFileSync(path.join(plansDir, id.slice(0, 32) + '.json'), 'utf8')); } catch { return null; } }
  function savePlan(p) { fs.mkdirSync(plansDir, {recursive: true}); const f = path.join(plansDir, p.id.slice(0, 32) + '.json'); fs.writeFileSync(f + '.tmp', JSON.stringify(p, null, 1), {mode: 0o600}); fs.renameSync(f + '.tmp', f); }

  async function start({exe, args, cwd, timeoutSec, cls, reason, planId = null, step = null}) {
    if ([...runs.values()].filter(r => r.state === 'running').length >= limits().parallel) throw Error('too_many_commands: wait for a running command or cancel it');
    const res = resolve(exe); if (!res) throw Error(`program_not_found: «${exe}» is not on PATH (give an absolute path or install it)`);
    const id = 'c-' + crypto.randomBytes(5).toString('hex');
    const rec = {id, state: 'running', cls, reason, text: commandText(exe, args, cwd), startedAt: new Date(now()).toISOString(), exitCode: null, out: '', err: '', planId, step,
      task: tasks?.peek?.()?.id || null};
    const max = limits().outKB * 1024;
    const child = spawnFn(res.file, [...res.pre, ...args], {cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env});
    rec.child = child;
    const add = k => c => { rec[k] += String(c); if (rec[k].length > max) { rec[k] = rec[k].slice(-max); rec.truncated = true; } };
    child.stdout?.on('data', add('out')); child.stderr?.on('data', add('err'));
    const done = new Promise(resolveDone => {
      child.once('error', e => { rec.state = 'failed_to_start'; rec.err += String(e?.code || e?.message); rec.endedAt = new Date(now()).toISOString(); resolveDone(); });
      child.once('close', code => { if (rec.state === 'running') rec.state = 'exited'; rec.exitCode = code; rec.endedAt = new Date(now()).toISOString(); resolveDone(); });
    });
    rec.done = done;
    const timer = setTimeout(() => { if (rec.state === 'running') { rec.state = 'timeout'; kill({...rec, state: 'running'}); } }, (timeoutSec || limits().timeoutSec) * 1000);
    timer.unref?.(); done.then(() => clearTimeout(timer));
    runs.set(id, rec); if (runs.size > 50) runs.delete(runs.keys().next().value);
    audit({event: 'command_start', id, cls, reason, exe: base(exe), args: args.length, task: rec.task, plan: planId ? planId.slice(0, 12) : null});
    done.then(() => audit({event: 'command_end', id, state: rec.state, exitCode: rec.exitCode}));
    return rec;
  }

  async function finishOrPoll(rec, waitSec) {
    await Promise.race([rec.done, new Promise(r => setTimeout(r, waitSec * 1000).unref?.())]);
    const v = view(rec);
    if (['R2', 'R3'].includes(rec.cls) && tasks?.check) try { tasks.check({command: rec.id, cls: rec.cls, state: rec.state, exitCode: rec.exitCode}); } catch {}
    return rec.state === 'running' ? {...v, next: `Still running. Poll run_command {"action":"status","id":"${rec.id}"}; cancel with action "cancel".`} : v;
  }

  function checkArgs(a) {
    if (typeof a.exe !== 'string' || !a.exe || a.exe.length > 400) bad('exe');
    if (a.args !== undefined && (!Array.isArray(a.args) || a.args.length > 64 || !a.args.every(x => typeof x === 'string' && x.length <= 4000 && !x.includes('\0')))) bad('args');
    if (a.cwd !== undefined && (typeof a.cwd !== 'string' || !(path.win32.isAbsolute(a.cwd) || path.posix.isAbsolute(a.cwd) || !a.cwd.includes('..')))) bad('cwd');
    if (a.timeoutSec !== undefined && (!Number.isInteger(a.timeoutSec) || a.timeoutSec < 1 || a.timeoutSec > 3600)) bad('timeoutSec');
    if (a.waitSec !== undefined && (!Number.isInteger(a.waitSec) || a.waitSec < 0 || a.waitSec > 45)) bad('waitSec');
  }
  const planBusy = new Set();
  const cwdOf = a => (a.cwd == null ? cfg.workspace : path.isAbsolute(a.cwd) || path.win32.isAbsolute(a.cwd) ? a.cwd : path.join(cfg.workspace, a.cwd));

  const api = {
    async run_command(args = {}) {
      requireCap(caps, 'commands');
      if (!onlyKeys(args, ['action', 'id', 'exe', 'args', 'cwd', 'timeoutSec', 'waitSec', 'planId'])) bad();
      const action = args.action ?? 'run';
      if (action === 'status' || action === 'cancel') {
        const r = runs.get(args.id); if (!r) throw Error('unknown_command_id');
        if (action === 'cancel' && r.state === 'running') { await kill(r); r.state = 'cancelled'; r.cancelReason = 'agent'; await Promise.race([r.done, new Promise(x => setTimeout(x, 3000))]); }
        if (action === 'status' && r.state === 'running' && args.waitSec) await Promise.race([r.done, new Promise(x => setTimeout(x, args.waitSec * 1000))]);
        return view(r);
      }
      if (action !== 'run') bad('action');
      checkArgs(args);
      const argv = args.args || [], cwd = cwdOf(args);
      const c = classifyCommand(args.exe, argv, {allowedPackages: caps.allowedPackages || []});
      if (c.cls === 'deny') throw Error(`command_denied: ${c.reason} — NEXUS never runs this kind of command, with or without consent; the owner does it himself`);
      if (['R0', 'R1'].includes(c.cls) && !inRoots(cwd)) c.cls = c.cls === 'R0' ? 'R0' : 'R3';
      if (!fs.existsSync(cwd)) throw Error('cwd_not_found');
      if (!resolve(args.exe)) throw Error(`program_not_found: «${args.exe}» is not on PATH (give an absolute path or install it)`); // before asking the owner
      const text = commandText(args.exe, argv, cwd);
      const go = (extra = {}) => start({exe: args.exe, args: argv, cwd, timeoutSec: args.timeoutSec, cls: c.cls, reason: c.reason, ...extra}).then(r => finishOrPoll(r, args.waitSec ?? 30));
      if (args.planId !== undefined) {
        const p = typeof args.planId === 'string' && /^[a-f0-9]{64}$/.test(args.planId) ? loadPlan(args.planId) : null;
        if (!p || !p.approvedAt || p.id !== args.planId) throw Error('plan_not_approved');
        if (now() - Date.parse(p.approvedAt) > 7 * 24 * 3600_000) throw Error('plan_expired: approve it again');
        const i = p.steps.findIndex(s => s.exe === args.exe && JSON.stringify(s.args) === JSON.stringify(argv) && (s.cwd ?? null) === (args.cwd ?? null));
        if (i < 0) throw Error('plan_step_mismatch: this command is not a step of the approved plan (a changed plan needs a new approval)');
        return go({planId: p.id, step: i});
      }
      if (c.cls === 'R0' || c.cls === 'R1') return go();
      if (!consent) throw Error('consent_unavailable');
      const what = c.cls === 'R2' ? 'software_change' : 'arbitrary_command';
      return consent.requestGrant({what, target: `выполнить команду (${c.cls}: ${c.reason}): ${text}`, apply: () => go()});
    },

    /** Plans: propose (consent once for the exact list, hash-bound) → run steps via run_command planId, or action run (Host executes). */
    async command_plan(args = {}) {
      requireCap(caps, 'commands');
      if (!onlyKeys(args, ['action', 'planId', 'title', 'steps', 'resumeAfterRestart'])) bad();
      if (args.action === 'propose') {
        if (typeof args.title !== 'string' || !args.title || args.title.length > 120) bad('title');
        if (!Array.isArray(args.steps) || !args.steps.length || args.steps.length > 30) bad('steps');
        const steps = args.steps.map(s => { if (!onlyKeys(s, ['exe', 'args', 'cwd'])) bad('step'); checkArgs(s); return {exe: s.exe, args: s.args || [], cwd: s.cwd ?? null}; });
        for (const s of steps) { const c = classifyCommand(s.exe, s.args, {allowedPackages: caps.allowedPackages || []}); if (c.cls === 'deny') throw Error(`command_denied: ${c.reason} in step «${commandText(s.exe, s.args)}»`); }
        const title = args.title, resumeAfterRestart = args.resumeAfterRestart === true;
        const id = planHash(title + (resumeAfterRestart ? ' [resume]' : ''), steps);
        const list = steps.map((s, i) => `${i + 1}) ${commandText(s.exe, s.args, s.cwd)}`).join('; ');
        return consent.requestGrant({what: 'command_plan', target: `план «${title}» (${steps.length} шаг., sha256 ${id.slice(0, 12)}${resumeAfterRestart ? ', продолжать после перезапуска Host' : ''}): ${list}`.slice(0, 1800),
          apply: () => { const p = {id, title, steps, resumeAfterRestart, approvedAt: new Date(now()).toISOString(), state: 'approved', next: 0, results: []}; savePlan(p); audit({event: 'plan_approved', plan: id.slice(0, 12), steps: steps.length}); return {planId: id, approved: true, steps: steps.length}; }});
      }
      if (typeof args.planId !== 'string' || !/^[a-f0-9]{64}$/.test(args.planId)) bad('planId');
      const p = loadPlan(args.planId); if (!p) throw Error('unknown_plan');
      if (args.action === 'status') return {planId: p.id, title: p.title, state: p.state, next: p.next, steps: p.steps.length, results: p.results.slice(-30)};
      if (args.action === 'cancel') { p.state = 'cancelled'; savePlan(p); for (const r of runs.values()) if (r.planId === p.id && r.state === 'running') { await kill(r); r.state = 'cancelled'; r.cancelReason = 'plan_cancel'; } return {planId: p.id, state: p.state}; }
      if (args.action === 'run') { if (!p.approvedAt) throw Error('plan_not_approved'); api.runPlan(p.id).catch(() => {}); return {planId: p.id, state: 'running', from: p.next, next: `Host executes the steps by itself; poll command_plan {"action":"status","planId":"${p.id}"}.`}; }
      bad('action');
    },

    /** Host-side sequential execution of an approved plan (no model turn needed). Stops on failure, STOP or unknown outcome. */
    async runPlan(id, {gate = () => null} = {}) {
      const p = loadPlan(id); if (!p || !p.approvedAt || ['cancelled', 'finished', 'failed'].includes(p.state) || planBusy.has(id)) return p;
      planBusy.add(id);
      try { return await runSteps(p, id, gate); } finally { planBusy.delete(id); }
    },
  };
  async function runSteps(p, id, gate) {
      p.state = 'running'; savePlan(p);
      while (p.next < p.steps.length) {
        const why = gate(); if (why) { p.state = 'paused:' + why; savePlan(p); return p; }
        const s = p.steps[p.next];
        p.results[p.next] = {step: p.next, state: 'started', at: new Date(now()).toISOString()}; savePlan(p);
        const cwd = cwdOf(s);
        let rec;
        try { rec = await start({exe: s.exe, args: s.args, cwd, cls: 'plan', reason: 'approved_plan', planId: p.id, step: p.next}); await rec.done; }
        catch (e) { p.results[p.next] = {step: p.next, state: 'failed_to_start', error: String(e.message).slice(0, 120)}; p.state = 'failed'; savePlan(p); return p; }
        const fresh = loadPlan(id); if (fresh?.state === 'cancelled') return fresh;
        p.results[p.next] = {step: p.next, state: rec.state, exitCode: rec.exitCode, at: rec.endedAt};
        if (rec.state !== 'exited' || rec.exitCode !== 0) { p.state = 'failed'; savePlan(p); return p; }
        p.next++; savePlan(p);
      }
      p.state = 'finished'; savePlan(p); audit({event: 'plan_finished', plan: id.slice(0, 12)});
      return p;
  }
  Object.assign(api, {

    /** After a Host restart: plans the owner approved with resumeAfterRestart continue; a step that had started is NOT repeated. */
    resumePlansAfterRestart({gate = () => null} = {}) {
      let files = []; try { files = fs.readdirSync(plansDir).filter(f => f.endsWith('.json')); } catch { return []; }
      const out = [];
      for (const f of files) {
        const p = loadPlan(f.slice(0, -5)); if (!p || p.state !== 'running') continue;
        if (p.results[p.next]?.state === 'started') { p.results[p.next].state = 'unknown_outcome_host_restart'; p.state = 'waiting_agent'; savePlan(p); out.push({plan: p.id, state: p.state}); continue; }
        if (!p.resumeAfterRestart) { p.state = 'interrupted'; savePlan(p); out.push({plan: p.id, state: p.state}); continue; }
        out.push({plan: p.id, state: 'resumed'}); api.runPlan(p.id, {gate}).catch(() => {});
      }
      return out;
    },

    /** STOP / owner pause / finish_task / client cancel / Host stop: kill running commands. Lease end does not. */
    async cancelAll(reason) {
      const cancelled = [];
      for (const r of runs.values()) if (r.state === 'running') { await kill(r); r.state = 'cancelled'; r.cancelReason = reason; cancelled.push(r.id); }
      return {cancelled};
    },
    running: () => [...runs.values()].filter(r => r.state === 'running').map(r => r.id),
  });
  return api;
}
