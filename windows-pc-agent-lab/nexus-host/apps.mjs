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
import {isHardDenied, launchExeOk, APP_NAME, LAUNCH_NAME} from './capabilities.mjs';
import {appGate, classifyApp, notepadLaunchDecision, launchableExe} from './policy.mjs';
import {createDiscovery} from './discover.mjs';

/**
 * 0.5.2 TEMPORARY (A-02): Windows 11 Notepad restores the owner's previous session on a cold start. Until stage 4
 * hides restored tabs from captures/UIA and this is verified on the owner's PC, NEXUS does not cold-start Notepad.
 */
export const NOTEPAD_COLD_START_BLOCKED = true;

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (a, allowed) => isObj(a) && Object.keys(a).every(k => allowed.includes(k));
const bad = () => { throw Error('invalid_args'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function createApps({caps, store, consent, gui, handoff = null, workspace, platform = process.platform, systemRoot = process.env.SystemRoot,
  launcher = spawn, exists = fs.existsSync, wait = sleep, execDeps = {}, discovery = null}) {
  const disc = discovery || createDiscovery({platform, systemRoot});
  const policyMode = () => caps.appAccess !== 'allowlist';

  async function settle(proc, before, opts, source, rounds = 8) {
    let after = before;
    for (let i = 0; i < rounds; i++) {
      await wait(400);
      after = await gui.snapshotApp(proc);
      if (before !== null && after !== null && JSON.stringify(after) !== JSON.stringify(before)) {
        if (!opts.token || JSON.stringify(after).includes(opts.token)) break;
      }
    }
    return consent.recordCreated(before, after, source, opts);
  }

  function launch(exe, args) {
    const p = launcher(exe, args, {detached: true, stdio: 'ignore', windowsHide: false, shell: false});
    return new Promise((resolve, reject) => { p.once('error', () => reject(Error('app_launch_failed'))); p.once('spawn', () => { p.unref?.(); resolve(p.pid); }); });
  }

  return {
    async open_app(args) {
      if (!onlyKeys(args, ['app']) || typeof args.app !== 'string' || !LAUNCH_NAME.test(args.app)) bad();
      if (platform !== 'win32') throw Error('windows_only');
      if (args.app === 'notepad') {
        if (typeof systemRoot !== 'string' || !/^[a-zA-Z]:\\/.test(systemRoot)) throw Error('invalid_windows_system_root');
        const token = 'NEXUS-' + crypto.randomBytes(3).toString('hex');
        const dir = path.join(workspace, '.nexus-scratch'); fs.mkdirSync(dir, {recursive: true});
        const file = path.join(dir, token + '.txt');
        fs.writeFileSync(file, '', {flag: 'wx'});
        const before = await gui.snapshotApp('notepad');
        const nd = notepadLaunchDecision({running: Array.isArray(before) ? before.length > 0 : undefined});
        if (NOTEPAD_COLD_START_BLOCKED && nd.level !== 1) {
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
        if (!LAUNCH_NAME.test(name) || ['notepad', 'calculator'].includes(name)) bad();
        launchSpec = {name, exe: args.exe};
      } else if (args.name !== undefined) bad();
      const target = `разрешить NEXUS управление приложением «${proc}»` + (launchSpec ? ` и запуск ${launchSpec.exe} (open_app "${launchSpec.name}")` : '');
      return consent.requestGrant({what: 'app_access', target, apply: () => ({granted: proc, ...store.grantApp(proc, launchSpec, 'consent')})});
    },
  };
}
