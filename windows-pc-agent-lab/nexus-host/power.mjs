/**
 * NEXUS NEXT — power/lock model (FR-08, NX-052-25/27, architecture §4.4/§5). One state model, separate commands.
 *  lock         → LockWorkStation (autonomous: it only REMOVES access; unlocking is the owner's, never NEXUS's).
 *  display_off  → monitor power-save broadcast (autonomous). NOTE: any mouse/keyboard input — including NEXUS's own —
 *                 wakes the monitor, so it cannot hide the screen DURING GUI work (owner decision §0.1 stays open).
 *  sleep / hibernate / restart / shutdown → dry run by default. A verified remote recovery route remains.
 *                 If remote wake/logon is unconfirmed, a local restoration route requires a SINGLE signed OWNER
 *                 approval for that specific action, with a warning that NEXUS becomes unavailable.
 *                 Unsaved documents still block; restart preserves the existing attestation-consumption hook.
 *                 Restart/shutdown use a 60 s grace (`shutdown /a` aborts) and never /f (no forced close).
 *  wake / power_on → BLOCKED here: a sleeping/off PC runs no Host. Needs a device in the home LAN (FR-08.2).
 */
import path from 'node:path';
import {execFile} from 'node:child_process';
import {requireCap} from './capabilities.mjs';

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (a, allowed) => isObj(a) && Object.keys(a).every(k => allowed.includes(k));
export const POWER_ACTIONS = Object.freeze(['status', 'lock', 'display_off', 'sleep', 'hibernate', 'restart', 'shutdown', 'cancel_shutdown', 'wake', 'power_on']);

/** Parse the AVAILABLE section of localized powercfg /a; never count unavailable modes. */
export function isHibernateAvailable(sleepStates) {
  const lines = Array.isArray(sleepStates) ? sleepStates.map(String) : [];
  const unavailableAt = lines.findIndex(s => /(?:следующ\S*.*недоступн|following.*not available|not available.*following)/iu.test(s));
  const availableLines = lines.slice(0, unavailableAt === -1 ? lines.length : unavailableAt);
  return availableLines.some(s => /^\s*(?:hibernat(?:e|ion)|гибернац(?:ия|ии)|ibernazione|hibernaci[oó]n|ruhezustand)\s*$/iu.test(s));
}


function sys(f) { return path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', f); }
const SCRIPTS = {
  display_off: "Add-Type -Namespace N -Name W -MemberDefinition '[DllImport(\"user32.dll\")] public static extern int SendMessage(int h,int m,int w,int l);'; [N.W]::SendMessage(0xFFFF,0x0112,0xF170,2) | Out-Null",
  sleep: "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.Application]::SetSuspendState('Suspend',$false,$false)",
  hibernate: "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.Application]::SetSuspendState('Hibernate',$false,$false)",
};
const defaultExec = (exe, args) => new Promise(res => execFile(exe, args, {windowsHide: true, timeout: 30_000, env: (() => { const e = {...process.env}; delete e.PSModulePath; return e; })()}, (err, out, errOut) => res({code: err ? (err.code ?? 1) : 0, out: String(out), err: String(errOut)})));
const ps = script => [sys('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script]];

/**
 * facts(): {autostartVerified, logonChannelVerified, wakeDevice, unsavedOwnerDocs:[...], sleepStates:[...]} — gathered
 * by the runtime (diagnostics + capabilities); injected for tests.
 */
export function createPower({caps, consent = null, audit = () => {}, platform = process.platform, exec = defaultExec, facts = async () => ({}), onLock = () => {}, onBeforeRestart = () => {}}) {
  async function plan(action) {
    const f = await facts();
    const needsWake = ['sleep', 'hibernate', 'shutdown'].includes(action);
    const hasWake = !!f.wakeDevice;
    const hasLogonChannel = f.logonChannelVerified === true;
    // A physical owner can restore the PC locally. This is not proof of remote wake or logon.
    const manualRecovery = (needsWake && !hasWake) ||
      (['restart', 'hibernate', 'shutdown'].includes(action) && !hasLogonChannel);
    const pre = {};
    if (['restart', 'shutdown', 'sleep', 'hibernate'].includes(action)) {
      pre.noUnsavedOwnerDocuments = !(f.unsavedOwnerDocs || []).length;
      if (!manualRecovery) {
        pre.autostartVerified = f.autostartVerified === true;
        pre.logonChannelVerified = action === 'sleep' ? true : hasLogonChannel;
      }
    }
    if (needsWake && !manualRecovery) pre.independentWakeDevice = hasWake;
    if (action === 'hibernate') pre.hibernateSupported = isHibernateAvailable(f.sleepStates);
    const blockers = Object.entries(pre).filter(([, v]) => !v).map(([k]) => k);
    const warning = manualRecovery
      ? 'After the action NEXUS will disconnect. Remote wake or remote login is NOT confirmed. The owner must personally wake/power on and, if needed, sign into Windows at the PC.'
      : null;
    return {action, preconditions: pre, blockers,
      recovery: {mode: manualRecovery ? 'manual_owner_approval' : 'remote', independentWakeConfirmed: hasWake,
        remoteLogonConfirmed: hasLogonChannel, requiresSignedOwnerApproval: manualRecovery},
      ...(warning ? {warning} : {}),
      unsavedOwnerDocs: (f.unsavedOwnerDocs || []).slice(0, 10),
      consequences: {lock: 'Windows locks; NEXUS GUI work stops until the owner unlocks it.', display_off: 'Monitor goes to power-save; any input wakes it.',
        sleep: 'PC sleeps; Host, tunnel and Live View stop; owner must wake it physically unless a verified wake device is available.',
        hibernate: 'Windows saves memory state to disk; the Host becomes unreachable until boot or manual wake.',
        restart: 'Windows restarts in 60 s (owner can abort: shutdown /a); manual Windows sign-in may be required.',
        shutdown: 'PC turns off in 60 s; Host is gone until owner turns on PC by hand or a verified independent device powers it.'}[action] || ''};
  }
  async function execute(action) {
    if (platform !== 'win32') throw Error('windows_only');
    let r;
    if (action === 'lock') { onLock(); r = await exec(sys('rundll32.exe'), ['user32.dll,LockWorkStation']); }
    else if (action === 'display_off' || action === 'sleep' || action === 'hibernate') r = await exec(...ps(SCRIPTS[action]));
    else if (action === 'restart') r = await exec(sys('shutdown.exe'), ['/r', '/t', '60', '/c', 'NEXUS: restart approved by the owner. Abort: shutdown /a']);
    else if (action === 'shutdown') r = await exec(sys('shutdown.exe'), ['/s', '/t', '60', '/c', 'NEXUS: shutdown approved by the owner. Abort: shutdown /a']);
    else if (action === 'cancel_shutdown') r = await exec(sys('shutdown.exe'), ['/a']);
    audit({event: 'power_action', action, code: r?.code});
    return {action, accepted: r?.code === 0, exitCode: r?.code ?? null, note: 'accepted = Windows took the request; the transition itself is verified from outside (connection_status / Sentinel).'};
  }
  return {
    /** Owner profile switch lockAfterTask (decision 03.11 §0.1): lock Windows when a task ends. Not a chat-callable path. */
    lockNow: () => (platform === 'win32' ? execute('lock') : Promise.resolve({action: 'lock', accepted: false, note: 'windows_only'})),
    async power_action(args = {}, {consented = false} = {}) {
      requireCap(caps, 'power');
      if (!onlyKeys(args, ['action', 'dryRun']) || !POWER_ACTIONS.includes(args.action) || (args.dryRun !== undefined && typeof args.dryRun !== 'boolean')) throw Error('invalid_args');
      const a = args.action;
      if (a === 'wake' || a === 'power_on') return {action: a, status: 'BLOCKED', reason: 'no_independent_wake_device', detail: 'A sleeping or switched-off PC runs no Host. Waking needs a device in the home LAN (Wake-on-LAN sender) — not configured; buying/adding one is the owner\'s decision.'};
      if (a === 'status') return {sleepStatesAndWake: 'system_info topic power', facts: await facts()};
      if (['lock', 'display_off', 'cancel_shutdown'].includes(a)) return execute(a);
      const p = await plan(a);
      if (args.dryRun !== false) return {...p, dryRun: true, next: p.blockers.length ? `BLOCKED until: ${p.blockers.join(', ')}` : 'Preconditions met. To execute: power_action with dryRun:false → owner consent for exactly this action.'};
      if (p.blockers.length) return {...p, status: 'BLOCKED', executed: false};
      if (consented) {
        // Owner has separately signed both the channel attestation and the
        // restart permission. Consume the first BEFORE scheduling Windows:
        // no second unattended reboot can reuse a stale owner assertion.
        if (a === 'restart') await onBeforeRestart();
        return execute(a);
      }
      const manual = p.recovery.mode === 'manual_owner_approval';
      const name = {restart: 'перезагрузка', shutdown: 'выключение', sleep: 'сон', hibernate: 'гибернация'}[a];
      const target = `${name} Windows${['restart', 'shutdown'].includes(a) ? ' через 60 с' : ''} (${p.consequences})${manual ? ' ВНИМАНИЕ: NEXUS пропадёт из сети; независимый дистанционный запуск/вход не подтверждён. Владелец осознанно восстановит доступ ВРУЧНУЮ на ПК.' : ''}`;
      return consent.requestGrant({what: 'system_power', target,
        apply: () => this.power_action(args, {consented: true})});
    },
  };
}
