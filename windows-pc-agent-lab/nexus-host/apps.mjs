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

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (a, allowed) => isObj(a) && Object.keys(a).every(k => allowed.includes(k));
const bad = () => { throw Error('invalid_args'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function createApps({caps, store, consent, gui, workspace, platform = process.platform, systemRoot = process.env.SystemRoot,
  launcher = spawn, exists = fs.existsSync, wait = sleep, execDeps = {}}) {

  async function settle(proc, before, opts, source) {
    let after = before;
    for (let i = 0; i < 8; i++) {
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
        await launch(path.win32.join(systemRoot, 'System32', 'notepad.exe'), [file]);
        const created = await settle('notepad', before, {token}, 'open_app:notepad');
        return {started: true, app: 'notepad', scratchFile: '.nexus-scratch/' + token + '.txt', createdByNexus: created,
          note: 'NEXUS opened its own scratch document. Only windows/tabs listed in createdByNexus may be closed without asking the owner.'};
      }
      if (args.app === 'calculator') {
        const before = await gui.snapshotApp('CalculatorApp');
        const out = await executeJob('open_app', {app: 'calculator'}, {workspace, ...execDeps});
        return {...out, createdByNexus: await settle('CalculatorApp', before, {}, 'open_app:calculator'),
          note: 'Only windows/tabs listed in createdByNexus may be closed without asking the owner.'};
      }
      const exe = caps.launchApps?.[args.app];
      if (!exe) throw Error('app_not_granted: use manage_app_access request');
      if (!launchExeOk(exe) || !exists(exe)) throw Error('app_exe_invalid');
      const proc = path.win32.basename(exe).replace(/\.exe$/i, '');
      const before = await gui.snapshotApp(proc);
      const pid = await launch(exe, []);
      return {started: true, app: args.app, pid, createdByNexus: await settle(proc, before, {}, 'open_app:' + args.app),
        note: 'Only windows/tabs listed in createdByNexus may be closed without asking the owner.'};
    },

    manage_app_access(args) {
      if (!onlyKeys(args, ['action', 'process', 'exe', 'name']) || !['request', 'revoke', 'list'].includes(args.action)) bad();
      if (args.action === 'list') return {inputApps: caps.inputApps, launchApps: Object.entries(caps.launchApps || {}).map(([name, exe]) => ({name, exe}))};
      if (typeof args.process !== 'string' || !APP_NAME.test(args.process)) bad();
      const proc = args.process.replace(/\.exe$/i, '');
      if (isHardDenied(proc)) throw Error('app_hard_denied');
      if (args.action === 'revoke') return {revoked: proc, ...store.revokeApp(proc, 'manage_app_access')};
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
