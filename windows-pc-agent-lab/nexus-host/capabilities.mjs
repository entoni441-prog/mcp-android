/**
 * NEXUS Host 0.4.0 — owner-controlled capability switches.
 * File: %USERPROFILE%\.nexus-host\capabilities.json (outside the workspace, so no NEXUS tool can edit it).
 * Created with safe defaults on first run. Dangerous groups are OFF until the owner edits the file and restarts.
 *
 * Hard limits below are NOT configurable: shells, terminals, script hosts, UAC/system UI never become targets
 * of input, run_task or process_action, whatever the file says.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CAPABILITIES = Object.freeze({
  screen_capture: true,      // capture_screen (read-only, but shows everything visible on screen)
  ui_read: true,             // window_info, inspect_ui, focus_window — only for inputApps
  gui_input: false,          // mouse_action, keyboard_action — DANGEROUS
  process_control: false,    // process_action — DANGEROUS
  run_task: false,           // run_task/task_status/task_cancel — DANGEROUS
  browser: false,            // browser_* (separate Edge profile) — DANGEROUS
  live_view: false,          // 0.5.0: live screen stream (watch_nexus widget, gateway /live) — shows everything on screen
  grantsFromChat: true,      // 0.5.1: owner switch — may set_capability RAISE a grant from chat? (lowering is always allowed)
  inputApps: ['Notepad', 'CalculatorApp'],
  launchApps: {},            // 0.5.0: owner-approved launchable apps {name: absolute exe path}; added via manage_app_access
  tasks: {},
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
  'python', 'pythonw', 'py', 'cloudflared', 'code', 'cursor', 'git-bash', 'mintty', 'ssh', 'putty', 'claude', 'bitwarden', 'keepass', 'keepassxc', '1password', 'lastpass', 'dashlane', 'keeper',
]);

const norm = s => String(s).toLowerCase().replace(/\.exe$/i, '');
export const isHardDenied = name => HARD_DENY.includes(norm(name));

const BOOL_KEYS = ['screen_capture', 'ui_read', 'gui_input', 'process_control', 'run_task', 'browser', 'live_view', 'grantsFromChat'];
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

/** Reads capabilities.json; writes the default file on first run. A broken file fails closed (host refuses to start). */
export function loadCapabilities(home) {
  const file = path.join(home, 'capabilities.json');
  if (!fs.existsSync(file)) {
    const doc = {_comment: 'NEXUS capabilities. Edit and restart nexus.mjs. Dangerous groups are false by default.', ...DEFAULT_CAPABILITIES};
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', {flag: 'wx'});
  }
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  return {file, caps: validateCapabilities(JSON.parse(text))};
}

export function requireCap(caps, key) {
  if (caps?.[key] !== true) throw Error('capability_disabled');
}
