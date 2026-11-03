/**
 * NEXUS Host 0.5.0 — opening apps and owner-managed app access.
 *
 * open_app
 *  - notepad: opens a NEW empty scratch file  <workspace>/.nexus-scratch/NEXUS-<token>.txt  in Notepad. The unique
 *    token in the tab/window name identifies exactly what NEXUS opened — also on a cold start of Windows 11 Notepad
 *    that restores the owner's previous session (defect found on the owner's PC 01.11.2026). Owner tabs are never
 *    owned by NEXUS, so closing them always needs consent.
 *  - calculator: as before (v3 launcher); ownership via fail-closed snapshot diff.
 *  - any other name: only apps the owner granted (capabilities.launchApps, added via manage_app_access + consent).
 *    Fixed absolute .exe path, no arguments, no shell; fail-closed ownership.
 *
 * manage_app_access
 *  - request: consent_required; on confirm_action(allow) the process name is added to inputApps (and, with exe, to
 *    launchApps). HARD_DENY (shells, script hosts, system UI, password managers…) can never be granted.
 *  - revoke: immediate (lowering a privilege needs no consent). list: current grants.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {executeJob} from '../v3/actions.mjs';
import {isHardDenied, launchExeOk, APP_NAME, LAUNCH_NAME, MAX_WINDOWS_HARD} from './capabilities.mjs';
import {appGate, classifyApp, notepadLaunchDecision, launchableExe} from './policy.mjs';
import {createDiscovery} from './discover.mjs';

/**
 * 0.5.2 A-02 (stage 4, permanent rule — replaces the stage-2 temporary flag NOTEPAD_COLD_START_BLOCKED):
 *  (a) NEXUS never cold-starts Windows 11 Notepad: a cold start restores the owner's previous session (unsaved tabs
 *      with secrets) on screen. If no Notepad window exists → Owner Handoff (the owner opens it; capture is paused).
 *  (b) Warm start: NEXUS adds ONE scratch tab; every Notepad window that holds a tab NEXUS does not own is masked in
 *      capture_screen / Live View (gui.captureMasks) and its document text is never returned by inspect_ui.
 */
const sansRect = a => JSON.stringify(a.map(({rect, ...w}) => w)); // a moved/resized window is not a "new window"

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (a, allowed) => isObj(a) && Object.keys(a).every(k => allowed.includes(k));
const bad = () => { throw Error('invalid_args'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Owner requirement 02.11: NEXUS keeps at most this many of its own windows/tabs open at once. */
/** @deprecated NEXT-1: replaced by caps.windowBudget (regulation) + MAX_WINDOWS_HARD (protective ceiling). */
export const MAX_OWN_WINDOWS = 4;

export function createApps({caps, store, consent, gui, handoff = null, workspace, platform = process.platform, systemRoot = process.env.SystemRoot,
  launcher = spawn, exists = fs.existsSync, wait = sleep, execDeps = {}, discovery = null, audit = () => {}}) {
  const disc = discovery || createDiscovery({platform, systemRoot});
  const policyMode = () => caps.appAccess !== 'allowlist';

  async function settle(proc, before, opts, source, rounds = 8) {
    let after = before;
    for (let i = 0; i < rounds; i++) {
      await wait(400);
      after = await gui.snapshotApp(proc);
      if (before !== null && after !== null && sansRect(after) !== sansRect(before)) {
        if (!opts.token || JSON.stringify(after).includes(opts.token)) break;
      }
    }
    return consent.recordCreated(before, after, source, opts);
  }

  function launch(exe, args) {
    const p = launcher(exe, args, {detached: true, stdio: 'ignore', windowsHide: false, shell: false});
    // NEXT NX-052-22: an exact reason instead of a bare app_launch_failed (elevation → owner handoff, never bypassed).
    return new Promise((resolve, reject) => { p.once('error', e => reject(Error(launchError(e)))); p.once('spawn', () => { p.unref?.(); resolve(p.pid); }); });
  }

  /** Owner requirement 02.11: NEXUS windows/tabs still open now (owned by NEXUS AND present on screen). */
  async function openOwned() {
    const o = consent.owned, out = [];
    for (const app of o.apps) {
      const ws = await gui.snapshotApp(app).catch(() => null);
      if (!Array.isArray(ws)) { out.partial = true; continue; }
      for (const w of ws) {
        if (o.windows.has(String(w.hwnd))) out.push({app, hwnd: w.hwnd});
        else for (const t of w.tabs || []) if (o.tabs.has(t.rid)) out.push({app, hwnd: w.hwnd, tab: true});
      }
    }
    return out;
  }

  async function openApp(args) {
      if (!onlyKeys(args, ['app', 'reason']) || typeof args.app !== 'string' || !LAUNCH_NAME.test(args.app) || (args.reason !== undefined && (typeof args.reason !== 'string' || args.reason.length > 200))) bad();
      if (platform !== 'win32') throw Error('windows_only');
      { // NEXT-1 (owner decision Р2, 03.11): windows are a REGULATION — open → act → verify → close per window — not a count limit.
        const open = await openOwned();
        const lc = gui.lifecycle?.classify?.(open, {prune: !open.partial});
        const say = l => l.map(w => `${w.app}${w.pid ? ' pid ' + w.pid : ''}`).join(', ');
        if (lc?.unverified.length) throw Error(`nexus_window_unverified: you worked in your ${say(lc.unverified)} window and have not checked the result - check it (inspect_ui / window_info / capture_screen) before opening the next app`);
        const n = new Set(open.map(w => String(w.hwnd))).size, budget = caps.windowBudget ?? 4;
        if (n >= MAX_WINDOWS_HARD) throw Error(`nexus_window_ceiling: NEXUS already has ${n} of its own windows open (protective ceiling ${MAX_WINDOWS_HARD}) - close the ones you have finished with`);
        if (n >= budget && !(typeof args.reason === 'string' && args.reason.trim().length >= 3)) {
          return {started: false, status: 'window_budget_reason_required', open: n, budget, windows: [...new Set(open.map(w => w.app))],
            instruction: `NEXUS already has ${n} of its own windows (regulation: ${budget}). Close the windows you have finished with (close_window), or call open_app again with "reason": why this task needs another window at the same time.`};
        }
        if (n >= budget) audit({event: 'window_budget_exceeded', open: n, budget, reason: args.reason.slice(0, 120)});
      }
      if (args.app === 'notepad') {
        if (typeof systemRoot !== 'string' || !/^[a-zA-Z]:\\/.test(systemRoot)) throw Error('invalid_windows_system_root');
        const token = 'NEXUS-' + crypto.randomBytes(3).toString('hex');
        const dir = path.join(workspace, '.nexus-scratch'); fs.mkdirSync(dir, {recursive: true});
        const file = path.join(dir, token + '.txt');
        fs.writeFileSync(file, '', {flag: 'wx'});
        const before = await gui.snapshotApp('notepad');
        const nd = notepadLaunchDecision({running: Array.isArray(before) ? before.length > 0 : undefined});
        if (nd.level !== 1) {
          fs.rmSync(file, {force: true});
          const legacy = {started: false, status: 'owner_action_required', reason: nd.reason, app: 'notepad',
            instruction: 'Notepad is not running. A cold start would restore the owner\'s previous Notepad session (it may contain secrets). Ask the owner to open Notepad themselves, then call open_app notepad again — or use another editor.'};
          if (typeof handoff !== 'function') return legacy;
          // 0.5.2 N-03: verified handoff — NEXUS waits for a Notepad window, screen capture paused (restored tabs may hold secrets).
          return {...handoff({reason: nd.reason, what: 'Откройте Блокнот сами (NEXUS не запускает его с нуля: Блокнот восстанавливает ваши прошлые вкладки).',
            where: 'меню «Пуск» → Блокнот', check: 'NEXUS проверит, что окно Блокнота появилось, затем откроет в нём свою отдельную вкладку',
            verify: {kind: 'app_window', process: 'notepad'}, pause: {input: true, capture: true}, resume: {tool: 'open_app', args: {app: 'notepad'}}}),
            started: false, app: 'notepad', instruction: legacy.instruction};
        }
        await launch(path.win32.join(systemRoot, 'System32', 'notepad.exe'), [file]);
        const created = await settle('notepad', before, {token}, 'open_app:notepad');
        return {started: true, app: 'notepad', scratchFile: '.nexus-scratch/' + token + '.txt', createdByNexus: created,
          note: 'NEXUS opened its own scratch document. Only windows/tabs listed in createdByNexus may be closed without asking the owner.'};
      }
      if (args.app === 'calculator') {
        // 0.5.1: Calculator is a UWP app — its visible window is an ApplicationFrameHost frame (the 'apps' snapshot now
        // reports such frames under CalculatorApp). It also appears asynchronously: wait up to ~6 s, then keep
        // watching in the background for up to ~10 s more and record the window when exactly one new one appears.
        const before = await gui.snapshotApp('CalculatorApp');
        const out = await executeJob('open_app', {app: 'calculator'}, {workspace, ...execDeps});
        const created = await settle('CalculatorApp', before, {}, 'open_app:calculator', 15);
        if (!created.windows.length && Array.isArray(before)) {
          created.pending = 'watching_async';
          (async () => {
            for (let i = 0; i < 10; i++) {
              await wait(1000);
              const now = await gui.snapshotApp('CalculatorApp');
              if (!Array.isArray(now)) return;
              const prev = new Set(before.map(w => String(w.hwnd)));
              const fresh = now.filter(w => !prev.has(String(w.hwnd)));
              if (fresh.length === 1) { consent.recordCreated(before, now, 'open_app:calculator:async'); return; }
              if (fresh.length > 1) return; // ambiguous (owner opened another one too) → not owned
            }
          })().catch(() => {});
        }
        return {...out, createdByNexus: created,
          note: 'Only windows/tabs listed in createdByNexus may be closed without asking the owner.' + (created.pending ? ' The window was still opening; NEXUS keeps watching for ~10 s and will own it when it appears.' : '')};
      }
      if (args.app === 'explorer' || args.app === 'file-explorer') {
        // 0.5.2 acceptance 02.11: Win11 «File Explorer» Start entry is a shell item (no .exe target) → discovery missed it.
        // Built-in path like Calculator: %SystemRoot%\explorer.exe, no arguments (opens Home; NEXUS navigates by GUI).
        if (typeof systemRoot !== 'string' || !/^[a-zA-Z]:\\/.test(systemRoot)) throw Error('invalid_windows_system_root');
        const g = appGate(caps, 'explorer.exe', {mode: 'focus'});
        if (!g.allow) throw Error(`app_not_allowed: ${g.error}${g.reason ? ' ' + g.reason : ''}`);
        const before = await gui.snapshotApp('explorer');
        await launch(path.win32.join(systemRoot, 'explorer.exe'), []);
        return {started: true, app: 'explorer', via: 'builtin', createdByNexus: await settle('explorer', before, {}, 'open_app:explorer', 15),
          note: 'Only windows/tabs listed in createdByNexus may be closed without asking the owner. Deleting files needs owner consent.'};
      }
      let exe = caps.launchApps?.[args.app] || null, via = 'granted';
      if (!exe && policyMode()) { const d = await disc.find(args.app); if (d) { exe = d.exe; via = 'discovered'; } }
      if (!exe) throw Error(policyMode() ? 'app_not_found: see manage_app_access list' : 'app_not_granted: use manage_app_access request');
      { // 0.5.2: launching follows the app class (focus semantics: a protected app may be opened, never read without consent)
        const g = appGate(caps, path.win32.basename(exe), {mode: 'focus'});
        if (!g.allow) throw Error(`app_not_allowed: ${g.error}${g.reason ? ' ' + g.reason : ''}`);
      }
      if (!(policyMode() ? launchableExe(exe) : launchExeOk(exe)) || !exists(exe)) throw Error('app_exe_invalid');
      const proc = path.win32.basename(exe).replace(/\.exe$/i, '');
      const before = await gui.snapshotApp(proc);
      const pid = await launch(exe, []);
      return {started: true, app: args.app, via, pid, createdByNexus: await settle(proc, before, {}, 'open_app:' + args.app),
        note: 'Only windows/tabs listed in createdByNexus may be closed without asking the owner.'};
  }

  return {
    async open_app(args) {
      const r = await openApp(args);
      if (r?.started) gui.forgetNexusWindow?.(); // the new window is NEXUS's: the next input adopts it
      return r;
    },

    manage_app_access(args) {
      if (!onlyKeys(args, ['action', 'process', 'exe', 'name']) || !['request', 'revoke', 'list'].includes(args.action)) bad();
      if (args.action === 'list') {
        const base = {appAccess: caps.appAccess, blockedApps: caps.blockedApps, inputApps: caps.inputApps, launchApps: Object.entries(caps.launchApps || {}).map(([name, exe]) => ({name, exe}))};
        if (!policyMode()) return base;
        return disc.list().then(all => ({...base, note: 'Policy mode: any listed app can be opened with open_app {app} and used without a grant; protected apps (password managers) need consent to be read; shells/UAC → owner.',
          installed: all.slice(0, 300).map(({app, name, cls}) => ({app, name, cls})), installedTotal: all.length}));
      }
      if (typeof args.process !== 'string' || !APP_NAME.test(args.process)) bad();
      const proc = args.process.replace(/\.exe$/i, '');
      if (isHardDenied(proc)) throw Error('app_hard_denied');
      if (args.action === 'revoke') return {revoked: proc, ...store.revokeApp(proc, 'manage_app_access')};
      if (policyMode() && args.exe === undefined && appGate(caps, proc, {mode: 'input'}).allow)
        return {granted: false, alreadyAllowed: true, process: proc, cls: classifyApp(proc).cls, note: 'No grant needed in policy mode.'};
      let launchSpec = null;
      if (args.exe !== undefined) {
        if (!launchExeOk(args.exe)) throw Error('app_exe_invalid');
        if (isHardDenied(path.win32.basename(args.exe))) throw Error('app_hard_denied');
        if (platform === 'win32' && !exists(args.exe)) throw Error('app_exe_not_found');
        const name = (args.name ?? proc).toLowerCase();
        if (!LAUNCH_NAME.test(name) || ['notepad', 'calculator', 'explorer', 'file-explorer'].includes(name)) bad();
        launchSpec = {name, exe: args.exe};
      } else if (args.name !== undefined) bad();
      const target = `разрешить NEXUS управление приложением «${proc}»` + (launchSpec ? ` и запуск ${launchSpec.exe} (open_app "${launchSpec.name}")` : '');
      return consent.requestGrant({what: 'app_access', target, apply: () => ({granted: proc, ...store.grantApp(proc, launchSpec, 'consent')})});
    },
  };
}

/** NEXT NX-052-22: spawn error → precise, owner-readable reason. */
export function launchError(e) {
  const c = String(e?.code || '');
  if (c === 'ENOENT') return 'app_launch_failed: exe_not_found — the program file does not exist (uninstalled or moved); check manage_app_access list / system_info';
  if (c === 'EACCES' || c === 'EPERM' || e?.errno === 740) return 'app_launch_failed: requires_elevation_or_access_denied — the program asks for administrator rights (UAC) or is blocked; NEXUS never raises rights: ask the owner to start it himself (UAC is his)';
  if (c === 'UNKNOWN' || c === 'EINVAL') return 'app_launch_failed: not_a_launchable_exe — Windows refused to start this file (blocked by policy such as Smart App Control, or not a program)';
  return 'app_launch_failed: ' + (/^[A-Z0-9_]{2,20}$/.test(c) ? c.toLowerCase() : 'unknown');
}
