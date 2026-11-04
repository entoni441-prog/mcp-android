/**
 * NEXUS Host 0.4.0 — owner-controlled capability switches.
 * File: %USERPROFILE%\.nexus-host\capabilities.json (outside the workspace, so no NEXUS tool can edit it).
 * 0.6.1: everything available by default; the owner restricts by command (ownerBans). Older profiles are migrated once.
 *
 * Hard limits below are NOT configurable: shells, terminals, script hosts, UAC/system UI never become targets
 * of input, run_task or process_action, whatever the file says.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** NEXT-1: protective ceiling against a runaway loop (not a working limit). */
export const MAX_WINDOWS_HARD = 16;
export const DEFAULT_CAPABILITIES = Object.freeze({
  screen_capture: true,      // capture_screen (read-only, but shows everything visible on screen)
  ui_read: true,             // window_info, inspect_ui, focus_window — only for inputApps
  // 0.6.1 owner decision 04.11.2026 (NX-052-36): everything is AVAILABLE by default; restrictions come only from the
  // owner's words (set_capability false → ownerBans). Only the fixed OWNER list (consent.mjs) needs his tap on the phone.
  gui_input: true,           // mouse_action, keyboard_action
  process_control: true,     // process_action
  run_task: true,            // run_task/task_status/task_cancel
  browser: true,             // browser_* (separate Edge profile)
  live_view: true,           // live screen stream (watch_nexus widget, gateway /live — passphrase protected)
  grantsFromChat: true,      // 0.5.1: owner switch — may set_capability RAISE a grant from chat? (lowering is always allowed)
  inputApps: ['Notepad', 'CalculatorApp'],
  appAccess: 'policy',       // 0.5.2: 'policy' = any app by class (policy.mjs); 'allowlist' = 0.5.1 inputApps only
  protectedPaths: [],        // 0.5.2: absolute folders/files the owner marked protected (N-02), in addition to built-ins
  blockedApps: [],           // 0.5.2: apps the owner blocked (revoke) — never a target in policy mode
  launchApps: {},            // 0.5.0: owner-approved launchable apps {name: absolute exe path}; added via manage_app_access
  tasks: {},
  windowBudget: 4,
  // ── NEXUS NEXT (owner profile; raising from chat is NOT possible for these) ──
  diagnostics: true,         // system_info: fixed read-only Windows queries (R0)
  commands: true,            // run_command/command_plan: autonomous; destructive/security commands → owner tap; deny list
  power: true,               // power_action (sleep/restart/shutdown keep their technical preconditions)
  taskRoots: ['~'],          // folders outside the workspace where NEXUS works; '~' = the owner's profile folder
  ownerBans: [],             // 0.6.1: switches the OWNER turned off by command — lifting one needs his tap on the phone
  allowedPackages: [],       // winget ids the owner pre-approved for install/uninstall (R2 → autonomous)
  lockAfterTask: false,      // owner decision 03.11 §0.1: lock Windows after finish_task (no task → locked); off until the owner enables it
  logonChannelVerified: false, // owner sets true after HE verified remote logon after a reboot (CRD/RDP) — gate for restart
  wakeDevice: null,          // name of an independent LAN wake device the owner configured; null → sleep/shutdown BLOCKED
  limits: {},                // {maxTasks, maxCopyMB, commandTimeoutSec, maxOutputKB, maxCommands} — profile, not code           // NEXT-1: regulation, not a limit — more NEXUS windows at once need a stated reason (open_app reason)
  javaPath: null,
  edgePath: null,
});

/** Process names (without .exe, case-insensitive) that can never be a GUI target, task or stop target. */
export const HARD_DENY = Object.freeze([
  'cmd', 'powershell', 'pwsh', 'powershell_ise', 'windowsterminal', 'wt', 'conhost', 'openconsole', 'bash', 'wsl', 'wslhost',
  'wscript', 'cscript', 'mshta', 'rundll32', 'regsvr32', 'regedit', 'reg', 'mmc', 'msiexec', 'taskmgr', 'consent',
  'logonui', 'lockapp', 'winlogon', 'credentialuibroker', 'useraccountcontrolsettings', 'systemsettings', 'control',
  'explorer', 'searchhost', 'startmenuexperiencehost', 'shellexperiencehost', 'applicationframehost', 'dwm', 'csrss',
  'lsass', 'services', 'svchost', 'smss', 'wininit', 'sihost', 'securityhealthsystray', 'msmpeng', 'secinit', 'sc',
  'schtasks', 'netsh', 'bcdedit', 'diskpart', 'format', 'takeown', 'icacls', 'certutil', 'bitsadmin', 'node', 'java', 'javaw',
  'python', 'pythonw', 'py', 'cloudflared', 'code', 'cursor', 'git-bash', 'mintty', 'ssh', 'putty', 'bitwarden', 'keepass', 'keepassxc', '1password', 'lastpass', 'dashlane', 'keeper',
]);

const norm = s => String(s).toLowerCase().replace(/\.exe$/i, '');
export const isHardDenied = name => HARD_DENY.includes(norm(name));

const BOOL_KEYS = ['screen_capture', 'ui_read', 'gui_input', 'process_control', 'run_task', 'browser', 'live_view', 'grantsFromChat', 'diagnostics', 'commands', 'power', 'logonChannelVerified', 'lockAfterTask'];
/** NEXT: limits moved from code to the profile (architecture §4.2) — [default, min, max]. */
export const LIMITS = Object.freeze({maxTasks: [3, 1, 10], maxCopyMB: [50, 1, 2048], commandTimeoutSec: [600, 5, 3600], maxOutputKB: [256, 16, 4096], maxCommands: [3, 1, 10]});
export const limit = (caps, k) => caps?.limits?.[k] ?? LIMITS[k][0];
export const APP_NAME = /^[A-Za-z0-9._-]{1,60}$/;
export const LAUNCH_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const TASK_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const BAD_TASK_EXT = /\.(cmd|bat|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|lnk|scr|com|msi|reg)$/i;

/** Launchable exe: absolute local path (no UNC), .exe only, not a script host / shell / HARD_DENY process. */
export function launchExeOk(exe) {
  if (typeof exe !== 'string' || exe.length > 400 || exe.includes('\0') || exe.startsWith('\\\\') || exe.startsWith('//')) return false;
  if (!(path.win32.isAbsolute(exe) && /^[a-zA-Z]:\\/.test(exe)) && !path.posix.isAbsolute(exe)) return false;
  if (!/\.exe$/i.test(exe) || BAD_TASK_EXT.test(exe)) return false;
  return !isHardDenied(path.win32.basename(exe));
}

export function validateCapabilities(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('invalid_capabilities');
  const c = {...DEFAULT_CAPABILITIES, inputApps: [...DEFAULT_CAPABILITIES.inputApps], tasks: {}, launchApps: {}};
  for (const k of Object.keys(raw)) if (!Object.hasOwn(DEFAULT_CAPABILITIES, k) && !k.startsWith('_')) throw Error('invalid_capabilities: unknown key ' + k);
  for (const k of BOOL_KEYS) if (Object.hasOwn(raw, k)) {
    if (typeof raw[k] !== 'boolean') throw Error('invalid_capabilities: ' + k);
    c[k] = raw[k];
  }
  if (Object.hasOwn(raw, 'windowBudget')) {
    if (!Number.isInteger(raw.windowBudget) || raw.windowBudget < 1 || raw.windowBudget > MAX_WINDOWS_HARD) throw Error('invalid_capabilities: windowBudget');
    c.windowBudget = raw.windowBudget;
  }
  if (Object.hasOwn(raw, 'appAccess')) {
    if (!['policy', 'allowlist'].includes(raw.appAccess)) throw Error('invalid_capabilities: appAccess');
    c.appAccess = raw.appAccess;
  }
  c.blockedApps = [];
  if (Object.hasOwn(raw, 'blockedApps')) {
    if (!Array.isArray(raw.blockedApps) || raw.blockedApps.length > 100 || !raw.blockedApps.every(a => typeof a === 'string' && APP_NAME.test(a))) throw Error('invalid_capabilities: blockedApps');
    c.blockedApps = raw.blockedApps.map(a => a.replace(/\.exe$/i, ''));
  }
  Object.freeze(c.blockedApps);
  for (const k of ['taskRoots']) {
    c[k] = [os.homedir()];
    if (Object.hasOwn(raw, k)) {
      const P = Array.isArray(raw[k]) ? raw[k].map(x => (x === '~' ? os.homedir() : x)) : raw[k];
      if (!Array.isArray(P) || P.length > 50 || !P.every(x => typeof x === 'string' && x.length <= 400 && !x.includes('\0') && !x.startsWith('\\\\') && (path.win32.isAbsolute(x) || path.posix.isAbsolute(x)))) throw Error('invalid_capabilities: ' + k);
      if (P.some(x => /^[a-zA-Z]:\\?$/.test(x) || x === '/')) throw Error('invalid_capabilities: taskRoots must not be a whole drive');
      c[k] = [...P];
    }
    Object.freeze(c[k]);
  }
  c.ownerBans = [];
  if (Object.hasOwn(raw, 'ownerBans')) {
    if (!Array.isArray(raw.ownerBans) || !raw.ownerBans.every(k => BOOL_KEYS.includes(k))) throw Error('invalid_capabilities: ownerBans');
    c.ownerBans = [...new Set(raw.ownerBans)];
  }
  Object.freeze(c.ownerBans);
  if (Object.hasOwn(raw, 'wakeDevice') && raw.wakeDevice !== null) {
    if (typeof raw.wakeDevice !== 'string' || !/^[\w .:-]{1,80}$/.test(raw.wakeDevice)) throw Error('invalid_capabilities: wakeDevice');
    c.wakeDevice = raw.wakeDevice;
  }
  c.allowedPackages = [];
  if (Object.hasOwn(raw, 'allowedPackages')) {
    if (!Array.isArray(raw.allowedPackages) || raw.allowedPackages.length > 100 || !raw.allowedPackages.every(x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{1,99}$/.test(x))) throw Error('invalid_capabilities: allowedPackages');
    c.allowedPackages = [...raw.allowedPackages];
  }
  Object.freeze(c.allowedPackages);
  c.limits = {};
  if (Object.hasOwn(raw, 'limits')) {
    const L = raw.limits;
    if (!isObjPlain(L)) throw Error('invalid_capabilities: limits');
    for (const [k, v] of Object.entries(L)) {
      if (!LIMITS[k] || !Number.isInteger(v) || v < LIMITS[k][1] || v > LIMITS[k][2]) throw Error('invalid_capabilities: limits.' + k);
      c.limits[k] = v;
    }
  }
  Object.freeze(c.limits);
  c.protectedPaths = [];
  if (Object.hasOwn(raw, 'protectedPaths')) {
    const P = raw.protectedPaths;
    if (!Array.isArray(P) || P.length > 100 || !P.every(x => typeof x === 'string' && x.length <= 400 && !x.includes('\0') && (path.win32.isAbsolute(x) || path.posix.isAbsolute(x)))) throw Error('invalid_capabilities: protectedPaths');
    c.protectedPaths = [...P];
  }
  Object.freeze(c.protectedPaths);
  if (Object.hasOwn(raw, 'inputApps')) {
    if (!Array.isArray(raw.inputApps) || raw.inputApps.length > 20 || !raw.inputApps.every(a => typeof a === 'string' && /^[A-Za-z0-9._-]{1,60}$/.test(a))) throw Error('invalid_capabilities: inputApps');
    c.inputApps = raw.inputApps.map(a => a.replace(/\.exe$/i, '')).filter(a => !isHardDenied(a));
  }
  for (const k of ['javaPath', 'edgePath']) if (Object.hasOwn(raw, k) && raw[k] !== null) {
    if (typeof raw[k] !== 'string' || !path.win32.isAbsolute(raw[k]) && !path.posix.isAbsolute(raw[k])) throw Error('invalid_capabilities: ' + k);
    c[k] = raw[k];
  }
  if (Object.hasOwn(raw, 'launchApps')) {
    const L = raw.launchApps;
    if (!L || typeof L !== 'object' || Array.isArray(L) || Object.keys(L).length > 30) throw Error('invalid_capabilities: launchApps');
    for (const [name, exe] of Object.entries(L)) {
      if (!LAUNCH_NAME.test(name) || ['notepad', 'calculator'].includes(name)) throw Error('invalid_capabilities: launchApps name ' + name);
      if (!launchExeOk(exe)) throw Error('invalid_capabilities: launchApps exe ' + name);
      c.launchApps[name] = exe;
    }
    Object.freeze(c.launchApps);
  }
  if (Object.hasOwn(raw, 'tasks')) {
    if (!raw.tasks || typeof raw.tasks !== 'object' || Array.isArray(raw.tasks) || Object.keys(raw.tasks).length > 30) throw Error('invalid_capabilities: tasks');
    for (const [name, t] of Object.entries(raw.tasks)) {
      if (!TASK_NAME.test(name) || !t || typeof t !== 'object') throw Error('invalid_capabilities: task ' + name);
      const exe = t.exe;
      if (typeof exe !== 'string' || !(path.win32.isAbsolute(exe) || path.posix.isAbsolute(exe)) || exe.startsWith('\\\\')) throw Error('invalid_capabilities: task exe ' + name);
      if (BAD_TASK_EXT.test(exe) || isHardDenied(path.win32.basename(exe))) throw Error('invalid_capabilities: task exe denied ' + name);
      const args = t.args ?? [];
      if (!Array.isArray(args) || args.length > 40 || !args.every(a => typeof a === 'string' && a.length <= 500 && !a.includes('\0'))) throw Error('invalid_capabilities: task args ' + name);
      const timeoutSec = t.timeoutSec ?? 300;
      if (!Number.isInteger(timeoutSec) || timeoutSec < 1 || timeoutSec > 3600) throw Error('invalid_capabilities: task timeoutSec ' + name);
      if (t.cwd !== undefined && (typeof t.cwd !== 'string' || !(path.win32.isAbsolute(t.cwd) || path.posix.isAbsolute(t.cwd)))) throw Error('invalid_capabilities: task cwd ' + name);
      c.tasks[name] = Object.freeze({exe, args: [...args], timeoutSec, cwd: t.cwd ?? null});
    }
  }
  return Object.freeze(c);
}

/** 0.6.1: switches that were OFF only because of old defaults (not by the owner's command). */
export const AVAILABLE_BY_DEFAULT = Object.freeze(['gui_input', 'process_control', 'run_task', 'browser', 'live_view', 'commands', 'power']);
export const PROFILE_VERSION = 2;

/**
 * 0.6.1 migration (owner decision 04.11.2026): a profile written by ≤0.6.0 had dangerous groups OFF as a DEFAULT,
 * not as the owner's ban. Turn them on (except keys in ownerBans), add the profile folder to taskRoots if empty,
 * keep everything else (blockedApps, protectedPaths, launchApps, tasks, limits…). Backup → capabilities.pre-0.6.1.json.
 * Pure on the object; returns {raw, changes}.
 */
export function migrateProfile(raw) {
  if (raw?._profile >= PROFILE_VERSION) return {raw, changes: {}};
  const out = {...raw}, changes = {};
  const bans = Array.isArray(raw.ownerBans) ? raw.ownerBans : [];
  for (const k of AVAILABLE_BY_DEFAULT) if (out[k] !== true && !bans.includes(k)) { changes[k] = [out[k] ?? null, true]; out[k] = true; }
  if (!Array.isArray(out.taskRoots) || !out.taskRoots.length) { changes.taskRoots = [out.taskRoots ?? null, ['~']]; out.taskRoots = ['~']; }
  if (!Array.isArray(out.ownerBans)) out.ownerBans = [];
  out._profile = PROFILE_VERSION;
  return {raw: out, changes};
}

/** Reads capabilities.json; writes the default file on first run; migrates older profiles once. A broken file fails closed. */
export function loadCapabilities(home) {
  const file = path.join(home, 'capabilities.json');
  if (!fs.existsSync(file)) {
    const doc = {_comment: 'NEXUS capabilities. Everything is available by default; the owner restricts by command in chat.', _profile: PROFILE_VERSION, ...DEFAULT_CAPABILITIES, taskRoots: ['~']};
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', {flag: 'wx'});
  }
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  let raw = JSON.parse(text), migrated = null;
  if (!(raw?._profile >= PROFILE_VERSION)) {
    validateCapabilities(raw); // never migrate a broken file
    const m = migrateProfile(raw);
    const backup = path.join(home, 'capabilities.pre-0.6.1.json');
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, text, {flag: 'wx'});
    const tmp = file + '.migrate.tmp';
    fs.writeFileSync(tmp, JSON.stringify(m.raw, null, 2) + '\n');
    fs.renameSync(tmp, file);
    raw = m.raw; migrated = {changes: m.changes, backup};
  }
  return {file, caps: validateCapabilities(raw), migrated};
}

function isObjPlain(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

export function requireCap(caps, key) {
  if (caps?.[key] !== true) throw Error('capability_disabled');
}
