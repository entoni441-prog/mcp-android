/**
 * NEXUS Host 0.4.0 — GUI tools.
 *  - Java Robot (NexusRobot.java, JDK 17, long-lived child): screenshots, mouse, keyboard.
 *  - Windows PowerShell 5.1 + UI Automation (uia-script.mjs): focus, window info, control tree, target checks.
 *
 * Coordinate space exposed to ChatGPT: "screen points" = Java logical coordinates of the primary screen.
 * capture_screen returns `imageToScreen` (screen points per image pixel; 1 when not downscaled).
 * UIA rectangles are mapped to screen points via the UIA desktop rectangle vs Java screen size (self-calibrating
 * for any DPI awareness of powershell.exe). More than one monitor → mapping refused (not verified).
 *
 * Safety (input):
 *  - capability gui_input must be true (default false);
 *  - mouse: the UIA element under EACH target point must belong to an allowlisted app (inputApps) and not HARD_DENY;
 *  - keyboard: the focused element must belong to an allowlisted app;
 *  - Windows key is not in the key table; text goes via clipboard paste (previous text clipboard restored);
 *  - after every action the focused app is re-read and reported. Residual risk: ~0.1–0.3 s between the check and
 *    the Robot event (Java daemon is pre-warmed to keep this short). Documented, not eliminated.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {UIA_SCRIPT} from './uia-script.mjs';
import {requireCap} from './capabilities.mjs';
import {appGate, classifyApp, classifyIdeInput, classifyIdeClick, redactSecrets, handoffSpec, classifyDestructiveClick, classifyDestructiveKeys, allowedWindowProcess, isTitlebarMinimizeTouch} from './policy.mjs';
import {classifyKeys, classifyClick, createConsent} from './consent.mjs';
import {createLifecycle} from './lifecycle.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROBOT_SRC = path.join(HERE, 'NexusRobot.java');
const MAX_IMAGE_W = 1568;
const TEXT_CONTROLS = new Set(['Document', 'Edit']);
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (a, allowed) => isObj(a) && Object.keys(a).every(k => allowed.includes(k));
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const bad = () => { throw Error('invalid_args'); };

// ───────────── Java Robot daemon ─────────────
export function findJava(caps, env = process.env, exists = fs.existsSync, platform = process.platform) {
  if (caps?.javaPath) return exists(caps.javaPath) ? caps.javaPath : null;
  const exe = platform === 'win32' ? 'java.exe' : 'java';
  const cands = [];
  if (env.JAVA_HOME) cands.push(path.join(env.JAVA_HOME, 'bin', exe));
  if (platform === 'win32' && env.ProgramFiles) {
    const base = path.win32.join(env.ProgramFiles, 'Eclipse Adoptium');
    try { for (const d of fs.readdirSync(base).sort().reverse()) cands.push(path.win32.join(base, d, 'bin', exe)); } catch { /* none */ }
  }
  const hit = cands.find(p => exists(p));
  return hit || 'java'; // PATH fallback (Temurin installer adds it; confirmed by preflight)
}

export class RobotDaemon {
  constructor({javaPath, spawnFn = spawn, timeoutMs = 20_000}) { Object.assign(this, {javaPath, spawnFn, timeoutMs}); this.proc = null; this.queue = []; this.buf = ''; }
  start() {
    if (this.proc) return this.ready;
    const p = this.spawnFn(this.javaPath, ['-Djava.awt.headless=false', ROBOT_SRC], {cwd: HERE, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
    this.proc = p;
    this.ready = new Promise((resolve, reject) => { this.queue.push({resolve, reject, timer: setTimeout(() => this.fail('robot_start_timeout'), 60_000)}); });
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', c => { this.buf += c; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); this.onLine(line); } });
    p.stderr.on('data', () => {});
    p.once('error', () => this.fail('java_launch_failed'));
    p.once('exit', () => this.fail('robot_exited'));
    return this.ready;
  }
  onLine(line) {
    const q = this.queue.shift(); if (!q) return;
    clearTimeout(q.timer);
    if (line.startsWith('ok ')) { try { q.resolve(JSON.parse(line.slice(3))); } catch { q.reject(Error('robot_bad_output')); } }
    else q.reject(Error(/^err [a-z_]+$/.test(line) ? line.slice(4) : 'robot_bad_output'));
  }
  fail(code) {
    const q = this.queue; this.queue = []; this.proc = null;
    for (const x of q) { clearTimeout(x.timer); x.reject(Error(code)); }
  }
  async cmd(line) {
    if (/[\r\n]/.test(line)) throw Error('invalid_args');
    await this.start();
    return new Promise((resolve, reject) => {
      this.queue.push({resolve, reject, timer: setTimeout(() => { this.stop(); reject(Error('robot_timeout')); }, this.timeoutMs)});
      this.proc.stdin.write(line + '\n');
    });
  }
  stop() { try { this.proc?.kill(); } catch { /* gone */ } this.proc = null; }
}

// ───────────── PowerShell UIA runner ─────────────
export const UIA_BOOTSTRAP = "$s = $env:NEXUS_UIA_PS; Remove-Item Env:NEXUS_UIA_PS; . ([ScriptBlock]::Create($s))";
const UIA_BOOTSTRAP_B64 = Buffer.from(UIA_BOOTSTRAP, 'utf16le').toString('base64');
export function runUiaReal(args, {systemRoot = process.env.SystemRoot, tmpDir, timeoutMs = 20_000} = {}) {
  if (typeof systemRoot !== 'string' || !/^[a-zA-Z]:\\/.test(systemRoot)) throw Error('invalid_windows_system_root');
  const exe = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  fs.mkdirSync(tmpDir, {recursive: true});
  const out = path.join(tmpDir, 'uia-' + crypto.randomBytes(8).toString('hex') + '.json');
  // 0.5.1: the script outgrew the 32 767-char Windows command line as -EncodedCommand (spawn ENAMETOOLONG on CI).
  // A tiny fixed bootstrap runs the FIXED script text from an environment variable; request data still arrives only
  // as JSON in NEXUS_UIA_ARGS and is never part of code.
  const encoded = UIA_BOOTSTRAP_B64;
  return new Promise((resolve, reject) => {
    const p = spawn(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
      env: {...process.env, NEXUS_UIA_PS: UIA_SCRIPT, NEXUS_UIA_ARGS: JSON.stringify(args), NEXUS_UIA_OUT: out},
    });
    let err = '';
    const timer = setTimeout(() => { p.kill(); reject(Error('uia_timeout')); }, timeoutMs);
    p.stderr.on('data', c => { if (err.length < 8000) err += c; });
    p.once('error', () => { clearTimeout(timer); reject(Error('powershell_launch_failed')); });
    p.once('exit', code => {
      clearTimeout(timer);
      try {
        if (code !== 0 || !fs.existsSync(out)) {
          return reject(uiaFailure(err));
        }
        resolve(JSON.parse(fs.readFileSync(out, 'utf8').replace(/^﻿/, '')));
      } catch { reject(Error('uia_bad_output')); } finally { fs.rmSync(out, {force: true}); }
    });
  });
}

// ───────────── 0.6.1 NX-052-32: typing without the clipboard ─────────────
/**
 * Text is typed as keystrokes (System.Windows.Forms.SendKeys from the signed .NET Framework assembly — no compiled
 * code, nothing for Smart App Control to block): characters not on the current keyboard layout go as Unicode input.
 * The owner's clipboard is never touched, so there is nothing to restore (Java AWT cannot round-trip every Windows
 * clipboard format — the acceptance on 03.11 saw restored_partial). The text arrives only through an environment
 * variable, never as script code. On any failure the caller falls back to clipboard paste (reported as such).
 */
export const TYPE_SCRIPT = `$t = $env:NEXUS_TYPE_TEXT; Remove-Item Env:NEXUS_TYPE_TEXT
Add-Type -AssemblyName System.Windows.Forms
$sb = New-Object System.Text.StringBuilder
foreach ($ch in $t.ToCharArray()) {
  if ($ch -eq [char]13) { }
  elseif ($ch -eq [char]10) { [void]$sb.Append('{ENTER}') }
  elseif ($ch -eq [char]9) { [void]$sb.Append('{TAB}') }
  elseif ('+^%~(){}[]'.IndexOf($ch) -ge 0) { [void]$sb.Append('{' + $ch + '}') }
  else { [void]$sb.Append($ch) }
}
[System.Windows.Forms.SendKeys]::SendWait($sb.ToString())
[System.Windows.Forms.SendKeys]::Flush()`;
const TYPE_BOOTSTRAP_B64 = Buffer.from("$s = $env:NEXUS_TYPE_PS; Remove-Item Env:NEXUS_TYPE_PS; . ([ScriptBlock]::Create($s))", 'utf16le').toString('base64');
export function typeTextReal(text, {systemRoot = process.env.SystemRoot, timeoutMs = 60_000} = {}) {
  if (typeof systemRoot !== 'string' || !/^[a-zA-Z]:\\/.test(systemRoot)) return Promise.reject(Error('invalid_windows_system_root'));
  const exe = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    const p = spawn(exe, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', TYPE_BOOTSTRAP_B64],
      {stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env: {...process.env, NEXUS_TYPE_PS: TYPE_SCRIPT, NEXUS_TYPE_TEXT: text}});
    let err = '';
    const timer = setTimeout(() => { p.kill(); reject(Error('type_timeout')); }, timeoutMs);
    p.stderr.on('data', c => { if (err.length < 4000) err += c; });
    p.once('error', () => { clearTimeout(timer); reject(Error('powershell_launch_failed')); });
    p.once('exit', code => { clearTimeout(timer); code === 0 ? resolve({typed: text.length}) : reject(Object.assign(Error('type_failed'), {detail: psErrorText(err).slice(0, 300)})); });
  });
}

/** 0.5.2 acceptance 02.11: Task Manager auto-elevates; Windows UIPI denies a non-elevated NEXUS (UIA FromPoint →
 *  «Access is denied»). NEXUS does not elevate itself — the step is the owner's. Nothing was clicked or typed. */
export function uiaFailure(rawStderr) {
  const detail = psErrorText(rawStderr).slice(0, 800);
  if (/access is denied|отказано в доступе|accesso negato|UnauthorizedAccess|E_ACCESSDENIED|0x80070005/i.test(detail)) {
    return Object.assign(Error('target_elevated: this window runs with administrator rights; Windows blocks NEXUS (not elevated) from reading or controlling it. Nothing was done. Ask the owner to do this step.'), {detail});
  }
  return Object.assign(Error('uia_failed'), {detail});
}

/** 0.5.2: PowerShell stderr is CLIXML (progress records + <S S="Error"> lines) — keep only the error text with its
 *  line/position so a uia_failed detail shows WHERE the script failed (install 02.11: 500 chars were all progress XML). */
export function psErrorText(raw) {
  const s = String(raw || '');
  if (!s.includes('<Objs')) return s.trim();
  const parts = [...s.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map(m => m[1]);
  if (!parts.length) return s.trim();
  return parts.join('').replace(/_x000D__x000A_/g, '\n').replace(/_x([0-9A-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\n{2,}/g, '\n').trim();
}

// ───────────── coordinate mapping ─────────────
export function mapping(info, root) {
  if (!info || !root) return null;
  if (info.screens !== 1) {
    // NEXT multi-monitor: with ONE common DPI scale, Java user space = UIA physical pixels / scale, both with the primary
    // monitor at (0,0). Mixed scales → no reliable mapping (null). Robot input/capture stay on the primary monitor.
    const mons = Array.isArray(info.monitors) ? info.monitors : [];
    const sc = Number(mons[0]?.scale);
    if (!mons.length || !(sc > 0) || !mons.every(m => Math.abs(Number(m.scale) - sc) < 0.001)) return null;
    return {rx: sc, ry: sc, multi: true,
      toUia: (x, y) => ({x: Math.round(x * sc), y: Math.round(y * sc)}),
      rectToScreen: r => r && ({x: Math.round(r.x / sc), y: Math.round(r.y / sc), w: Math.round(r.w / sc), h: Math.round(r.h / sc)})};
  }
  if (!(info.w > 0 && info.h > 0 && root.w > 0 && root.h > 0)) return null;
  const rx = root.w / info.w, ry = root.h / info.h;
  return {
    rx, ry,
    toUia: (x, y) => ({x: Math.round(root.x + (x - info.x) * rx), y: Math.round(root.y + (y - info.y) * ry)}),
    rectToScreen: r => r && ({x: Math.round(info.x + (r.x - root.x) / rx), y: Math.round(info.y + (r.y - root.y) / ry), w: Math.round(r.w / rx), h: Math.round(r.h / ry)}),
  };
}

/**
 * 0.5.2 A-02: which Notepad windows must be painted over before a screen image leaves the Host.
 *  wins  = apps('notepad') snapshot (null = snapshot failed → caller must refuse the capture: fail-closed);
 *  owned = consent.owned; toScreen = rect mapper (UIA → screen points) or null.
 *  mode 'capture' (one-shot, fresh snapshot): a window is shown only if its SELECTED tab (or, without tabs, the window
 *    itself) was created by NEXUS. mode 'live' (cached up to LIVE_MASK_TTL_MS): shown only if it holds NO foreign tab —
 *    a tab switch between two cached snapshots can therefore never reveal an owner's document.
 * Returns {masks:[{x,y,w,h}], hidden:n} or null (cannot redact reliably → no image).
 */
export function notepadMasks(wins, owned, toScreen, mode = 'capture') {
  if (!Array.isArray(wins)) return null;
  const tabs = w => (Array.isArray(w?.tabs) ? w.tabs : []).filter(t => t && typeof t.rid === 'string' && t.rid);
  const masks = [];
  for (const w of wins) {
    const ts = tabs(w);
    const visibleOk = ts.length === 0 ? owned.windows.has(String(w.hwnd))
      : mode === 'live' ? ts.every(t => owned.tabs.has(t.rid))
        : (() => { const sel = ts.filter(t => t.selected); return sel.length === 1 && owned.tabs.has(sel[0].rid); })();
    if (visibleOk) continue;
    const r = w.rect && toScreen ? toScreen(w.rect) : null;
    if (!r || !(r.w > 0 && r.h > 0)) return null;
    masks.push(r);
  }
  return {masks, hidden: masks.length};
}
export const LIVE_MASK_TTL_MS = 1000;
const maskArg = m => (m.length ? m.slice(0, 32).map(r => [r.x, r.y, r.w, r.h].join(',')).join(';') : '-');

// ───────────── tiny PNG (image_selftest) ─────────────
function crc32(buf) { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
export function testPng(size = 64) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = y * (size * 3 + 1) + 1 + x * 3;
    const q = (x < size / 2) * 1 + (y < size / 2) * 2; // 4 quadrants: R, G, B, white
    const col = [[255, 40, 40], [40, 200, 40], [40, 80, 255], [250, 250, 250]][q];
    raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2];
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ───────────── tools ─────────────
export function createGui({caps, home, workspace, platform = process.platform, runUia, robot, typeText, consent = createConsent(), handoff = null, sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now(), onOwnerActive = () => {}}) {
  // 0.6.1: keystroke typing only on a real Windows host (tests with a fake platform keep the clipboard path)
  const typer = typeText !== undefined ? typeText : (platform === 'win32' && process.platform === 'win32' && !robot ? text => typeTextReal(text) : null);
  const lifecycle = createLifecycle({now});
  const tmpDir = path.join(home, 'tmp');
  const uia = runUia || (args => runUiaReal(args, {tmpDir}));
  let daemon = robot || null;
  const getRobot = () => {
    if (!daemon) {
      const javaPath = findJava(caps);
      if (!javaPath) throw Error('java_not_found');
      daemon = new RobotDaemon({javaPath});
    }
    return daemon;
  };
  const winOnly = () => { if (platform !== 'win32') throw Error('windows_only'); };
  let infoCache = null, rootCache = null;
  const info = async () => (infoCache ||= await getRobot().cmd('info'));

  /**
   * 0.5.2: every target goes through policy.appGate. Returns null (go on) or a consent_required result whose
   * confirm_action replays the same tool once, for the same window (policyOk), and only for that need.
   */
  const LABEL = {destructive_action: 'удаление/стирание данных в приложении', system_tool: 'системная утилита (изменения системы)', protected_app: 'защищённое приложение', security_page: 'страница безопасности', arbitrary_command: 'выполнение команды'};
  function describeInput(args, el) {
    if (typeof args?.text === 'string') return `ввод текста «${redactSecrets(args.text).text.slice(0, 200)}»`;
    if (typeof args?.keys === 'string') return `клавиши ${args.keys}`;
    if (args?.action) return `${args.action} по «${String(el?.name ?? '').slice(0, 80)}»`;
    return 'чтение окна';
  }
  function policy({proc, title = '', mode, hwnd = null, tool, args, opts, legacy, extra = null, el = null}) {
    const g = appGate(caps, proc, {title, mode});
    if (!g.allow && !g.consent) {
      // 0.5.2 N-03: an action only the owner may do (UAC, credential prompt, shell command) → Owner Handoff, not a dead end.
      const spec = g.error === 'owner_handoff_required' && mode !== 'read' && typeof handoff === 'function' ? handoffSpec(proc, g.reason, title) : null;
      if (spec) return handoff(spec);
      throw Error(`${legacy}: ${g.error}${g.reason ? ' ' + g.reason : ''}`);
    }
    const need = g.consent ? {level: g.consent, what: g.what} : extra;
    if (!need) return null;
    const pc = opts?.policyOk;
    if (pc) {
      if (pc.what === need.what && pc.hwnd === String(hwnd ?? '')) return null;
      throw Error('consent_target_changed');
    }
    const target = `${LABEL[need.what] || need.what} — ${proc}${title ? ` «${String(title).slice(0, 80)}»` : ''}: ${describeInput(args, el)}${need.via ? ` [${need.via}]` : ''}`;
    return consent.requestGrant({what: need.what, target, apply: () => api[tool](args, {policyOk: {what: need.what, hwnd: String(hwnd ?? '')}})});
  }

  async function checkPid(pid, mode = 'read', tool = null, args = null, opts = null) {
    const r = await uia({mode: 'windows', pid});
    const w0 = (r.windows || [])[0] || {};
    const g = policy({proc: r.target?.process, title: w0.name, mode, hwnd: w0.hwnd ?? 'pid:' + pid, tool, args, opts, legacy: 'app_not_allowed'});
    return g ? {consentResult: g} : r;
  }

  const NEW_KEYS = new Set(['ctrl+n', 'ctrl+t', 'ctrl+shift+n', 'shift+ctrl+n']);
  const apps = async name => (await uia({mode: 'apps', name})).apps || [];
  const tabsOf = w => (Array.isArray(w?.tabs) ? w.tabs : []).filter(t => t && typeof t.rid === 'string' && t.rid);

  // 0.5.2 A-02: redaction of Notepad windows holding the owner's (possibly restored) documents.
  let liveMaskCache = null;
  async function captureMasks(mode) {
    if (mode === 'live' && liveMaskCache && Date.now() - liveMaskCache.t < LIVE_MASK_TTL_MS) return liveMaskCache.v;
    let v = null;
    try {
      const r = await uia({mode: 'apps', name: 'notepad'});
      const m = mapping(await info(), r.root);
      v = notepadMasks(r.apps || [], consent.owned, m ? m.rectToScreen : null, mode);
    } catch { v = null; }
    if (mode === 'live') liveMaskCache = {t: Date.now(), v};
    if (!v) throw Error('capture_redaction_unavailable: NEXUS could not locate Notepad windows to hide the owner\'s documents, so no image is taken');
    return v;
  }
  /** inspect_ui includeText on Notepad: honoured only if every Notepad window of that pid shows a NEXUS-owned document. */
  async function notepadTextAllowed(pid) {
    let wins; try { wins = await apps('notepad'); } catch { return false; }
    const mine = wins.filter(w => w.pid === pid);
    const res = notepadMasks(mine.map(w => ({...w, rect: w.rect || {x: 0, y: 0, w: 1, h: 1}})), consent.owned, r => r, 'capture');
    return !!res && res.hidden === 0;
  }

  /** Press a prompt button that UIA could not Invoke: click its centre, only if UIA confirms the point is that button. */
  async function clickPromptButton(rect, hwnd, pid, role) {
    if (caps.gui_input !== true || !rect) return false;
    const inf = await info(), root = (await uia({mode: 'focused'})).root, m = mapping(inf, root);
    if (!m) return false;
    const ux = Math.round(rect.x + rect.w / 2), uy = Math.round(rect.y + rect.h / 2);
    const at = (await uia({mode: 'at', x: ux, y: uy})).at;
    const re = {save: /^(save|сохранить)$/i, discard: /^(don.?t save|do not save|не сохранять)$/i, cancel: /^(cancel|отмена)$/i}[role];
    if (!re?.test(at?.elem?.name || '')) return false;
    // in-window prompt (same hwnd) or the app's own dialog window (same process as the target window)
    if (!(String(at?.window?.hwnd) === String(hwnd) || (Number.isInteger(pid) && at?.pid === pid && at?.window?.pid === pid))) return false;
    const sp = m.rectToScreen({x: ux, y: uy, w: 0, h: 0});
    await getRobot().cmd(`click ${sp.x} ${sp.y} left 1`);
    return true;
  }

  /**
   * 0.5.1: close ONE window or tab by identity (hwnd + UIA runtime id), via UI Automation — no keystrokes, so nothing
   * can be typed into another window. Then handle a save prompt by `onPrompt`: 'save' | 'discard' | 'cancel'.
   * Caller decides the policy; this only executes it and verifies the result by a fresh snapshot.
   */
  async function closeTarget({process, hwnd, pid = null, rid = null, onPrompt}) {
    const r = await uia({mode: 'close', hwnd: Number(hwnd), ...(rid ? {rid} : {})});
    if (!r.found) return {closed: true, method: 'already_gone'};
    if (!r.invoked && rid && /^tab_close_button_(missing|not_invokable)$/.test(r.method || '')) {
      const k = await closeTabByKey({process, hwnd, pid, rid});
      if (!k.ok) return {closed: false, method: r.method, fallback: k.why};
      r.invoked = true; r.method = 'ctrl_w_verified';
    }
    if (!r.invoked) return {closed: false, method: r.method || 'not_invokable'};
    let prompt = null;
    for (let i = 0; i < 4; i++) {
      await sleep(400);
      const d = await uia({mode: 'dialog', hwnd: Number(hwnd)});
      if (d.dialog) { prompt = d; break; }
      if (await gone(process, hwnd, rid)) return {closed: true, method: r.method, prompt: null};
    }
    let answered = null;
    if (prompt) {
      const d = await uia({mode: 'dialog', hwnd: Number(hwnd), choice: onPrompt});
      const pressed = d.invoked ? 'invoke' : (await clickPromptButton(d.rect, hwnd, pid, onPrompt)) ? 'click' : null;
      if (!pressed) return {closed: false, method: r.method, prompt: 'shown', answered: null, note: 'prompt button could not be pressed'};
      answered = onPrompt; r.pressed = pressed;
      await sleep(600);
    }
    return {closed: await gone(process, hwnd, rid), method: r.method, prompt: prompt ? 'shown' : null, answered, ...(r.pressed ? {pressedBy: r.pressed} : {})};
  }
  /**
   * 0.5.1 live fix (Win11 Notepad: tab_close_button_missing). Ctrl+W only after UIA proves, right before the key, that
   * the target window is in the foreground AND the selected tab in it is exactly our tab (runtime id). Otherwise refuse:
   * a keystroke must never land in another window or on the owner's tab.
   */
  async function closeTabByKey({process, hwnd, pid, rid}) {
    if (caps.gui_input !== true) return {ok: false, why: 'gui_input_off'};
    try { await uia({mode: 'activate', hwnd: Number(hwnd), pid}); } catch { /* verified below */ }
    for (let i = 0; i < 3; i++) {
      const f = (await uia({mode: 'focused'})).focused;
      const w = (await apps(process)).find(x => String(x.hwnd) === String(hwnd));
      if (!w) return {ok: false, why: 'window_gone'};
      const sel = tabsOf(w).find(t => t.selected);
      if (f?.ok && String(f.topHwnd) === String(hwnd) && sel?.rid === rid) {
        await getRobot().cmd('key ctrl+w');
        return {ok: true};
      }
      await sleep(300);
    }
    return {ok: false, why: 'focus_or_selection_not_verified'};
  }
  async function gone(process, hwnd, rid) {
    let wins; try { wins = await apps(process); } catch { return false; }
    const w = wins.find(x => String(x.hwnd) === String(hwnd));
    return !w || (!!rid && !tabsOf(w).some(t => t.rid === rid));
  }

  // ── Owner requirement 02.11 (VISIBILITY & WINDOW LIFECYCLE), revision 2: do not fight the owner for the PC ────────
  // NEXUS remembers where IT left the mouse and which window IT worked in. Before new input:
  //  - the mouse is elsewhere → the owner moved it → owner_active, and the session is PAUSED (onOwnerActive);
  //  - typing: the foreground window changed to ANOTHER process not by NEXUS → owner_active, session PAUSED.
  // The pause is sticky: a still mouse does NOT mean the owner has finished. Work resumes only after an explicit
  // live_control resume, which the agent may call only when the owner said in chat to continue (session.mjs).
  // Limit: keyboard-only owner activity inside NEXUS's own window is not visible (no native input hook by design).
  let lastPointer = null, nexusWin = null;
  const far = (a, b) => Math.abs(a.x - b.x) > 4 || Math.abs(a.y - b.y) > 4;
  async function pointer() { try { const r = await getRobot().cmd('pointer'); return Number.isInteger(r?.x) && Number.isInteger(r?.y) ? r : null; } catch { return null; } }
  const OWNER_HINT = 'NEXUS paused ALL input until the owner explicitly says to continue - do not retry; tell the owner, and call live_control resume only after the owner said in this chat that you may continue';
  async function ownerGuard() {
    const p = await pointer();
    if (!p) return; // pointer unreadable: no evidence of the owner — the other policy checks still apply
    if (!lastPointer || !far(p, lastPointer)) { lastPointer = lastPointer || p; return; }
    try { onOwnerActive('mouse'); } catch { /* the refusal below still holds */ }
    throw Error(`owner_active: the owner moved the mouse - ${OWNER_HINT}`);
  }
  async function afterInput(f) {
    const p = await pointer(); if (p) lastPointer = p;
    if (f?.ok && f.topHwnd) { nexusWin = {hwnd: String(f.topHwnd), pid: f.pid ?? null, process: f.process || null}; lifecycle.input(nexusWin); }
  }
  function resetFocusState() { lastPointer = null; nexusWin = null; }

  const api = {
    consent,
    /** Snapshot all windows+tabs of a process name (used around open_app / new-tab keys to record NEXUS-created ones). */
    async snapshotApp(name) { if (platform !== 'win32') return []; try { return await apps(name); } catch { return null; } },
    warm() { if (caps.gui_input || caps.screen_capture) getRobot().start().catch(() => {}); },

    /**
     * 0.5.1 session end: close every window/tab NEXUS itself opened (never the owner's). Scratch documents: a save prompt
     * is answered «Save» (into the NEXUS scratch file — no data loss, no hanging dialog). Other NEXUS-opened windows
     * with unsaved changes: prompt answered «Cancel», window left open, reported (the owner decides).
     */
    resetFocusState,
    lifecycle,
    /** After the owner's explicit go-ahead: the current mouse position becomes NEXUS's reference again. */
    ownerResumed() { lastPointer = null; },
    /** open_app / handoff created a new foreground window: the next input adopts it (no stale-window refusal). */
    forgetNexusWindow() { nexusWin = null; },
    async cleanupOwned(reason, {ownerPaused = false} = {}) {
      resetFocusState();
      const o = consent.owned;
      const report = {closed: [], left: []};
      const unchecked = lifecycle.status().filter(e => !e.checked).map(e => e.app || 'window');
      if (unchecked.length) report.unverified = unchecked; // honest report: input whose result NEXUS never checked
      // Revision 2: the owner took over the PC and has not handed it back — NEXUS does not touch any window now
      // (the owner may be working in one of NEXUS's windows). Ownership is kept; the next session end cleans up.
      if (ownerPaused && reason !== 'owner_stop' && (o.windows.size || o.tabs.size)) { report.left.push({why: 'owner_at_pc_paused', windows: o.windows.size, tabs: o.tabs.size}); return report; }
      if (platform !== 'win32' || (!o.windows.size && !o.tabs.size)) return report;
      // Snapshot every app first; prune only when all snapshots succeeded (a failed snapshot must not drop ownership).
      const snaps = new Map(); let allOk = true;
      for (const proc of [...o.apps]) { try { snaps.set(proc, await apps(proc)); } catch { allOk = false; report.left.push({app: proc, why: 'snapshot_failed'}); } }
      if (allOk) consent.prune([...snaps.values()].flat());
      for (const [proc, wins] of snaps) {
        for (const w of wins) {
          const ownedTabs = tabsOf(w).filter(t => o.tabs.has(t.rid));
          const whole = o.windows.has(String(w.hwnd)) && tabsOf(w).every(t => o.tabs.has(t.rid));
          const items = whole ? [{rid: null, name: w.name, scratch: o.scratch.has(String(w.hwnd)) || (ownedTabs.length > 0 && ownedTabs.every(t => o.scratch.has(t.rid)))}]
            : ownedTabs.map(t => ({rid: t.rid, name: t.name, scratch: o.scratch.has(t.rid)}));
          for (const it of items) {
            let r;
            try { r = await closeTarget({process: proc, hwnd: w.hwnd, pid: w.pid, rid: it.rid, onPrompt: it.scratch ? 'save' : 'cancel'}); }
            catch (e) { r = {closed: false, error: String(e?.message || e).slice(0, 80)}; }
            const rec = {app: proc, name: String(it.name || '').slice(0, 120), kind: it.rid ? 'tab' : 'window', ...r};
            if (r.closed) { report.closed.push(rec); if (it.rid) consent.forgetTab(it.rid); else { consent.forget(w); lifecycle.forget(w.hwnd); } }
            else report.left.push({...rec, why: r.answered === 'cancel' ? 'unsaved_changes_owner_decides' : 'close_failed'});
          }
        }
      }
      return report;
    },

    /**
     * Universal owner-requested minimization of one top-level HWND using only
     * WindowPattern, never text input, mouse emulation, process stop or elevation.
     * Fail-closed on ambiguous target, secure desktop process, or verification.
     */
    async minimize_window(args) {
      requireCap(caps, 'gui_input'); winOnly();
      if(!onlyKeys(args,['pid','title','hwnd','ownerRequested'])||!int(args.pid,1,2**31))bad();
      if(args.title!==undefined&&(typeof args.title!=='string'||!args.title||args.title.length>200))bad();
      if(args.hwnd!==undefined&&!int(args.hwnd,1,Number.MAX_SAFE_INTEGER))bad();
      if(args.ownerRequested!==true||caps.grantsFromChat===false)
        throw Error('owner_request_required: explicit owner instruction to minimize this window');
      const found=await uia({mode:'windows',pid:args.pid});
      const proc=String(found.target?.process||'');
      if(!allowedWindowProcess(proc))throw Error('minimize_protected_process_refused');
      let wins=(found.windows||[]).filter(w=>Number.isSafeInteger(Number(w.hwnd))&&Number(w.hwnd)>0&&Number(w.pid)===args.pid);
      if(args.hwnd!==undefined)wins=wins.filter(w=>Number(w.hwnd)===args.hwnd);
      if(args.title)wins=wins.filter(w=>String(w.name||'').toLowerCase().includes(args.title.toLowerCase()));
      if(wins.length!==1)return {status:wins.length>1?'ambiguous':'not_found',
        candidates:wins.slice(0,15).map(w=>({hwnd:Number(w.hwnd),title:String(w.name||'').slice(0,100)})),
        instruction:'Provide a unique title or exact HWND. No window was changed.'};
      await ownerGuard();
      const w=wins[0],effect=await uia({mode:'minimize',pid:args.pid,hwnd:Number(w.hwnd)});
      if(effect?.verified!==true||effect.isMinimizedAfter!==true||Number(effect.pid)!==args.pid||
         String(effect.hwnd)!==String(w.hwnd)||
         String(effect.process||'').replace(/\.exe$/i,'').toLowerCase()!==proc.replace(/\.exe$/i,'').toLowerCase())
        throw Error('minimize_not_verified: no other input was attempted');
      return {status:effect.wasMinimized?'already_minimized':'minimized',
        process:proc,pid:args.pid,hwnd:Number(w.hwnd),verified:true,shellInputSent:false};
    },

    /**
     * 0.5.1 D5: close a window or tab by name. Autonomous when NEXUS opened it, or when the owner asked for exactly this
     * in chat (ownerRequested) and the owner's switch grantsFromChat is on. Otherwise consent_required. Unsaved changes in
     * an owner document are never discarded silently: onUnsaved 'ask' (default) cancels the prompt and returns
     * unsaved_choice_required — ask the owner «Save / Don't save / Cancel», then call again with that choice.
     */
    async close_window(args, {consented = null, decision = null} = {}) {
      requireCap(caps, 'gui_input'); winOnly();
      if (!onlyKeys(args, ['pid', 'title', 'tab', 'onUnsaved', 'ownerRequested']) || !int(args.pid, 1, 2 ** 31)) bad();
      for (const k of ['title', 'tab']) if (args[k] !== undefined && (typeof args[k] !== 'string' || !args[k] || args[k].length > 200)) bad();
      if (args.onUnsaved !== undefined && !['ask', 'save', 'discard', 'cancel'].includes(args.onUnsaved)) bad();
      if (args.ownerRequested !== undefined && typeof args.ownerRequested !== 'boolean') bad();
      const t = await checkPid(args.pid);
      const proc = t.target.process;
      const hw = new Set((t.windows || []).map(w => String(w.hwnd)));
      const lc = x => String(x || '').toLowerCase();
      let wins = (await apps(proc)).filter(w => hw.has(String(w.hwnd)));
      if (args.title) wins = wins.filter(w => lc(w.name).includes(lc(args.title)));
      if (args.tab) wins = wins.filter(w => tabsOf(w).some(x => lc(x.name).includes(lc(args.tab))));
      if (wins.length !== 1) return {status: wins.length ? 'ambiguous' : 'not_found', candidates: wins.slice(0, 10).map(w => w.name),
        instruction: wins.length ? 'Several windows match. Ask the owner which one, then call again with a more exact title/tab.' : 'No such window/tab of this process.'};
      const win = wins[0];
      let tab = null;
      if (args.tab) {
        const m = tabsOf(win).filter(x => lc(x.name).includes(lc(args.tab)));
        if (m.length !== 1) return {status: 'ambiguous', candidates: m.map(x => x.name), instruction: 'Several tabs match. Ask the owner which one.'};
        tab = m[0];
      }
      const kind = tab ? 'tab' : 'window';
      const c = {kind, via: 'close_window'};
      const own = consent.isOwned(c, win, tab);
      const byOwner = !own && args.ownerRequested === true && caps.grantsFromChat !== false;
      if (own && !consented && lifecycle.unverified(win.hwnd)) {
        throw Error(`nexus_verify_before_close: NEXUS typed/clicked in this window and has not checked the result yet - check it first (inspect_ui / window_info pid ${win.pid ?? args.pid} / capture_screen), then close it: open -> act -> verify -> close`);
      }
      if (consented) {
        if (String(win.hwnd) !== consented.hwnd || (consented.rid && tab?.rid !== consented.rid)) throw Error('consent_target_changed');
      } else if (!own && !byOwner) {
        const g = consent.gate(c, win, tab, {tool: 'close_window', args});
        if (g) return g;
      }
      // What to answer if the app asks to save. Discarding the OWNER's text needs an explicit owner choice.
      const scratch = tab ? consent.owned.scratch.has(tab.rid) : consent.owned.scratch.has(String(win.hwnd));
      let onPrompt;
      if (scratch) onPrompt = 'save';
      else if (consented) onPrompt = decision === 'close_discard' ? 'discard' : 'save';
      else if (args.onUnsaved === 'discard' && (own || byOwner)) onPrompt = 'discard';
      else if (args.onUnsaved === 'save') onPrompt = 'save';
      else onPrompt = 'cancel';
      const r = await closeTarget({process: proc, hwnd: win.hwnd, pid: win.pid, rid: tab?.rid || null, onPrompt});
      if (r.closed) { if (tab) consent.forgetTab(tab.rid); else { consent.forget(win); lifecycle.forget(win.hwnd); } }
      const out = {target: `${proc}: ${tab ? 'вкладка «' + tab.name + '»' : 'окно «' + win.name + '»'}`, kind, closed: r.closed,
        by: own ? 'nexus_owned' : consented ? 'confirm_action' : 'owner_request', prompt: r.prompt, answered: r.answered};
      if (!r.closed && r.prompt && r.answered === 'cancel' && (args.onUnsaved ?? 'ask') !== 'cancel') {
        return {...out, status: 'unsaved_choice_required', options: ['save', 'discard', 'cancel'],
          instruction: 'The document has unsaved changes; nothing was lost. Ask the owner exactly: Save, Don\'t save, or Cancel. Then call close_window again with onUnsaved = save | discard (or stop on cancel).'};
      }
      if (!r.closed && r.answered === 'save') out.note = 'Save may have opened a «Save as» dialog (document never saved before) — the owner should pick a location.';
      return out;
    },
    stop() { daemon?.stop(); },

    async image_selftest(args) {
      if (!onlyKeys(args, [])) bad();
      const png = testPng(64);
      return {content: [{type: 'image', data: png.toString('base64'), mimeType: 'image/png'},
        {type: 'text', text: 'image_selftest: 64x64 PNG with four squares: top-left white, top-right blue, bottom-left green, bottom-right red. If you can name them, MCP ImageContent reaches the model.'}],
        structured: {bytes: png.length, width: 64, height: 64, expected: {topLeft: 'white', topRight: 'blue', bottomLeft: 'green', bottomRight: 'red'}}};
    },

    async capture_screen(args) {
      requireCap(caps, 'screen_capture'); winOnly();
      if (!onlyKeys(args, ['maxWidth', 'saveToWorkspace'])) bad();
      const maxW = args.maxWidth ?? MAX_IMAGE_W;
      if (!int(maxW, 320, 2560)) bad();
      if (args.saveToWorkspace !== undefined && typeof args.saveToWorkspace !== 'boolean') bad();
      fs.mkdirSync(tmpDir, {recursive: true});
      const file = path.join(tmpDir, 'cap-' + crypto.randomBytes(8).toString('hex') + '.png');
      try {
        const mk = await captureMasks('capture');
        const r = await getRobot().cmd(`capture ${maxW} ${Buffer.from(file).toString('base64')} ${maskArg(mk.masks)}`);
        const png = fs.readFileSync(file);
        let saved = null;
        if (args.saveToWorkspace) {
          const dir = path.join(workspace, 'screenshots'); fs.mkdirSync(dir, {recursive: true});
          saved = 'screenshots/' + new Date().toISOString().replace(/[:.]/g, '-') + '.png';
          fs.writeFileSync(path.join(workspace, ...saved.split('/')), png, {flag: 'wx'});
        }
        const meta = {imageW: r.imageW, imageH: r.imageH, screenW: r.screenW, screenH: r.screenH,
          imageToScreen: +(r.screenW / r.imageW).toFixed(4), distinctColours: r.colours, pngBytes: png.length, ms: r.ms, savedTo: saved,
          ...(mk.hidden ? {hiddenWindows: mk.hidden, hiddenWhy: 'owner Notepad documents (not created by NEXUS) are painted over'} : {})};
        return {content: [{type: 'image', data: png.toString('base64'), mimeType: 'image/png'}, {type: 'text', text: JSON.stringify(meta)}], structured: meta};
      } finally { fs.rmSync(file, {force: true}); }
    },

    /** 0.5.0 Live View: one JPEG frame (cursor drawn in). Capability checks are done by live.mjs. */
    async frameJpeg(maxW, quality, caption = null, options = null) {
      winOnly();
      // Owner-only capture is NOT an MCP catalog tool. Only the Gateway-signed,
      // passphrase-authenticated owner channel can request this unmasked frame.
      // Model capture_screen and the normal app live_frame ALWAYS stay redacted.
      if (options !== null && (typeof options !== 'object' || Object.keys(options).some(k=>k!=='ownerOnly') || options.ownerOnly!==true)) throw Error('invalid_capture_scope');
      fs.mkdirSync(tmpDir, {recursive: true});
      const file = path.join(tmpDir, 'frm-' + crypto.randomBytes(8).toString('hex') + '.jpg');
      try {
        const mk = options?.ownerOnly === true ? {masks: [], hidden: 0} : await captureMasks('live');
        const cap = typeof caption === 'string' && caption ? ' ' + Buffer.from(caption.replace(/[^\x20-\x7e]/g, '?').slice(0, 160), 'utf8').toString('base64') : '';
        const r = await getRobot().cmd(`frame ${maxW} ${quality} ${Buffer.from(file).toString('base64')} ${maskArg(mk.masks)}${cap}`);
        return {jpeg: fs.readFileSync(file), meta: r};
      } finally { fs.rmSync(file, {force: true}); }
    },

    async window_info(args, opts = null) {
      requireCap(caps, 'ui_read'); winOnly();
      if (!onlyKeys(args, ['pid']) || !int(args.pid, 1, 2 ** 31)) bad();
      const r = await checkPid(args.pid, 'read', 'window_info', args, opts);
      if (r.consentResult) return r.consentResult;
      const m = mapping(await info(), r.root);
      return {pid: args.pid, process: r.target.process, foreground: r.focused?.pid === args.pid, coordinateMapping: !!m,
        windows: (r.windows || []).slice(0, 20).map(w => ({name: String(w.name || '').slice(0, 200), className: w.className, rect: m ? m.rectToScreen(w.rect) : null}))};
    },

    async inspect_ui(args, opts = null) {
      requireCap(caps, 'ui_read'); winOnly();
      if (!onlyKeys(args, ['pid', 'maxDepth', 'maxNodes', 'includeText']) || !int(args.pid, 1, 2 ** 31)) bad();
      const depth = args.maxDepth ?? 4, max = args.maxNodes ?? 150;
      if (!int(depth, 1, 8) || !int(max, 1, 400)) bad();
      if (args.includeText !== undefined && typeof args.includeText !== 'boolean') bad();
      const r = await uia({mode: 'tree', pid: args.pid, depth, max});
      const pg = policy({proc: r.target?.process, title: r.tree?.[0]?.name, mode: 'read', hwnd: 'pid:' + args.pid, tool: 'inspect_ui', args, opts, legacy: 'app_not_allowed'});
      if (pg) return pg;
      const m = mapping(await info(), r.root);
      // 0.5.2 A-02: in Notepad the owner's documents (incl. ones restored from a previous session) are never read.
      let withheld = null;
      if (args.includeText && String(r.target?.process || '').toLowerCase() === 'notepad' && !(await notepadTextAllowed(args.pid))) {
        args = {...args, includeText: false}; withheld = 'notepad_owner_document';
      }
      // 0.5.0 data protection: the Name of a Document/Edit control IS the document text (e.g. a password file open in
      // Notepad). Redacted unless includeText=true; only the length is returned.
      const redact = n => !args.includeText && TEXT_CONTROLS.has(n.type) && typeof n.name === 'string' && n.name ? `<text ${n.name.length}+ chars, includeText=true to read>` : n.name;
      let redacted = 0;
      const fix = n => { const name = redact(n); if (name !== n.name) redacted++; return {...n, name, rect: m ? m.rectToScreen(n.rect) : null, ...(n.children ? {children: n.children.map(fix)} : {})}; };
      const tree = (r.tree || []).map(fix);
      return {pid: args.pid, process: r.target.process, nodes: r.nodes, coordinateMapping: !!m, textRedacted: redacted,
        ...(withheld ? {textWithheld: withheld, hint: 'Text is shown only for documents NEXUS created (its scratch tab must be the selected tab of every Notepad window).'} : {}), tree};
    },

    async focus_window(args) {
      requireCap(caps, 'ui_read'); winOnly();
      if (caps.gui_input === true) await ownerGuard();
      const r = await api.focusWindowInner(args);
      if (r?.focused) await afterInput({ok: true, topHwnd: r.hwnd, pid: args.pid});
      return r;
    },
    async focusWindowInner(args) {
      if (!onlyKeys(args, ['pid']) || !int(args.pid, 1, 2 ** 31)) bad();
      const w = await checkPid(args.pid, 'focus');
      if (!w.windows?.length) throw Error('window_not_found');
      const hwnds = new Set(w.windows.filter(x => x.hwnd).map(x => String(x.hwnd)));
      const isOn = f => f?.ok === true && (f.pid === args.pid || (!!f.topHwnd && hwnds.has(String(f.topHwnd))));
      if (isOn(w.focused)) return {focused: true, already: true, method: 'none', hwnd: w.focused.topHwnd ?? null};
      const attempts = [];
      const titlebarProbes = [];
      const main = w.windows.find(x => x.hwnd) || w.windows[0];
      const r = await uia({mode: 'activate', pid: args.pid, ...(main.hwnd ? {hwnd: Number(main.hwnd)} : {}), title: String(main.name || '').slice(0, 200)});
      // 0.5.1 diagnostics: which step worked, and why not (minimised / off-screen / Windows foreground lock).
      const diag = {windowFound: r.windowFound ?? null, wasMinimized: !!r.wasMinimized, offscreen: r.offscreen ?? null, uiaSetFocus: !!r.setFocus,
        ...(r.setFocusError ? {setFocusError: r.setFocusError} : {}), foregroundBefore: r.foregroundBefore?.process || null};
      attempts.push({method: 'UIA.SetFocus+AppActivate', ...diag, byPid: !!r.appActivateByPid, byTitle: !!r.appActivateByTitle, foreground: r.focused?.process || null});
      if (isOn(r.focused)) return {focused: true, method: r.appActivateByPid ? 'AppActivate(pid)' : r.appActivateByTitle ? 'AppActivate(title)' : 'UIA.SetFocus', hwnd: r.focused.topHwnd ?? null, attempts};
      // Fallback (only with gui_input): click an EMPTY spot of the target window's own title bar. Each candidate point
      // is checked with UIA first: it must belong to the target window and must not be a button/tab/menu — so the click
      // can never land in someone else's window and never presses Close.
      if (caps.gui_input === true) {
        const inf = await info();
        const m = mapping(inf, w.root);
        for (const win of w.windows) {
          const rc = win.rect; if (!rc || !m) continue;
          for (const [fx, fy] of [[0.62, 10], [0.5, 10], [0.75, 10]]) {
            const ux = Math.round(rc.x + rc.w * fx), uy = Math.round(rc.y + fy);
            const at = await uia({mode: 'at', x: ux, y: uy, nativeHitTest: true});
            const el = at.at?.elem || {};
            const own = !!win.hwnd && String(at.at?.window?.hwnd) === String(win.hwnd);
            const passive = ['Window', 'TitleBar', 'Pane', 'Custom', 'Group'].includes(el.controlType) && !classifyClick('click', at.at);
            // Only claim occlusion when an independent native WindowFromPoint/GA_ROOT read confirms
            // UIA.FromPoint's OTHER window HWND + PID. UIA failure, stale/racing hit or out-of-screen
            // point is unverified, not proof of either occlusion or a Windows foreground lock.
            const hit = at.at?.nativeHit, top = at.at?.window;
            const nativeAgrees = hit?.ok === true && Number.isSafeInteger(Number(hit.hwnd)) && Number(hit.hwnd) > 0 &&
              Number.isInteger(Number(hit.pid)) && Number(hit.pid) > 0 && Number(hit.hwnd) === Number(top?.hwnd) &&
              Number(hit.pid) === Number(top?.pid) && Number(hit.pid) === Number(at.at?.pid);
            const screenPoint = m.rectToScreen({x: ux, y: uy, w: 0, h: 0});
            const visiblePoint = !!screenPoint && screenPoint.x >= inf.x && screenPoint.y >= inf.y &&
              screenPoint.x < inf.x + inf.w && screenPoint.y < inf.y + inf.h;
            const foreign = visiblePoint && nativeAgrees && !own && String(hit.hwnd) !== String(win.hwnd);
            const blocker = foreign ? {hwnd: Number(hit.hwnd), pid: Number(hit.pid), process: String(at.at?.process || '').slice(0, 64)} : null;
            const probe = {method: 'titlebar_probe', ok: own && passive, control: el.controlType || null,
              nativeVerified: nativeAgrees, ...(blocker ? {blockedBy: blocker} : {})};
            titlebarProbes.push(probe);
            attempts.push(probe);
            if (!own || !passive) continue;
            const sp = m.rectToScreen({x: ux, y: uy, w: 0, h: 0});
            await getRobot().cmd(`click ${sp.x} ${sp.y} left 1`);
            await sleep(300);
            const f = (await uia({mode: 'focused'})).focused;
            attempts.push({method: 'titlebar_click', foreground: f?.process || null});
            if (isOn(f)) return {focused: true, method: 'titlebar_click', hwnd: f.topHwnd ?? null, attempts};
            break;
          }
        }
      }
      // NX-26: all titlebar points occupied by independently verified other windows = occluded.
      // Do not report Windows' foreground lock merely because AppActivate failed while an
      // inaccessible or covered title bar prevented every safe fallback click.
      const occluded = titlebarProbes.length >= 2 && titlebarProbes.every(p => p.blockedBy);
      const clickedButNotFocused = attempts.some(p => p.method === 'titlebar_click');
      const blockers = occluded ? [...new Map(titlebarProbes.map(p =>
        [String(p.blockedBy.hwnd), p.blockedBy])).values()] : [];
      const cause = !main.hwnd || r.windowFound === false ? 'window_not_found_by_hwnd' : r.offscreen ? 'window_offscreen_or_covered'
        : occluded ? 'titlebar_occluded'
        : clickedButNotFocused ? 'foreground_lock_likely'
        : titlebarProbes.length ? 'titlebar_not_reachable'
        : (r.setFocus || r.appActivateByPid) ? 'foreground_lock_likely' : 'activation_refused';
      return {focused: false, method: 'none', cause, foregroundProcess: r.focused?.process || null, foregroundHwnd: r.focused?.topHwnd ?? null, windows: [...hwnds], attempts,
        ...(occluded ? {occlusion: {verified: true, probes: titlebarProbes.length, blockedBy: blockers}} : {}),
        hint: occluded ? 'Target title bar is covered by another window. No input was sent to it.'
          : caps.gui_input ? 'Window not reachable (covered or minimised?). No input was sent to other windows unless a safe titlebar_click was recorded.'
          : 'Enable gui_input to allow the safe title-bar fallback.'};
    },

    async mouse_action(args, {consented = null, decision = null, policyOk = null} = {}) {
      requireCap(caps, 'gui_input'); winOnly();
      if (!onlyKeys(args, ['action', 'x', 'y', 'x2', 'y2', 'amount'])) bad();
      const A = ['move', 'click', 'double_click', 'right_click', 'scroll', 'drag'];
      if (!A.includes(args.action) || !int(args.x, -20000, 20000) || !int(args.y, -20000, 20000)) bad();
      const pts = [[args.x, args.y]];
      if (args.action === 'drag') { if (!int(args.x2, -20000, 20000) || !int(args.y2, -20000, 20000)) bad(); pts.push([args.x2, args.y2]); }
      else if (args.x2 !== undefined || args.y2 !== undefined) bad();
      if (args.action === 'scroll') { if (!int(args.amount, -20, 20) || args.amount === 0) bad(); } else if (args.amount !== undefined) bad();
      const inf = await info();
      if (inf.screens !== 1 && !mapping(inf, rootCache || (await uia({mode: 'focused'})).root)) throw Error('multi_monitor_mixed_dpi_unsupported: monitors use different scaling; set one scale for all monitors or move the window to the primary monitor');
      if (inf.screens !== 1 && Array.isArray(inf.monitors)) {
        const p = inf.monitors.find(m => m.primary) || inf.monitors[0];
        for (const [x, y] of pts) if (x < p.x || y < p.y || x >= p.x + p.w || y >= p.y + p.h) throw Error('point_on_secondary_monitor: NEXUS input and capture work on the primary monitor; move the window there (focus_window) first');
      }
      let target = null, lastAt = null;
      if (!rootCache) rootCache = (await uia({mode: 'focused'})).root;
      for (const [x, y] of pts) {
        const m = mapping(inf, rootCache); if (!m) throw Error('coordinate_mapping_failed');
        const u = m.toUia(x, y);
        const at = await uia({mode: 'at', x: u.x, y: u.y, nativeHitTest: args.action === 'click'});
        if (JSON.stringify(at.root) !== JSON.stringify(rootCache)) { rootCache = at.root; infoCache = null; throw Error('screen_changed_retry'); }
        // A precisely identified caption MINIMIZE button is not application input.
        // Route by verified top-level HWND directly to WindowPattern and retain the
        // strict application policy for all other clicks, including terminal text.
        const cap=at.at?.nativeCaptionMinimize;
        const hit=at.at?.nativeHit;
        const nativeMin= args.action==='click' && cap?.verified===true &&
          hit?.ok===true && Number(cap.pid)===Number(hit.pid) &&
          Number(cap.hwnd)===Number(hit.hwnd) && allowedWindowProcess(cap.process);
        if(isTitlebarMinimizeTouch(at.at,args.action) || nativeMin){
          await ownerGuard();
          const win=nativeMin ? cap : at.at.window;
          const effect=await uia({mode:'minimize',pid:Number(win.pid),hwnd:Number(win.hwnd)});
          if(effect?.verified!==true||effect.isMinimizedAfter!==true||
             Number(effect.pid)!==Number(win.pid)||String(effect.hwnd)!==String(win.hwnd)||
             String(effect.process||'').replace(/\.exe$/i,'').toLowerCase()!==
               String(win.process||'').replace(/\.exe$/i,'').toLowerCase())
             throw Error('minimize_not_verified: no mouse input was sent');
          return {done:true,action:'minimize',pid:Number(win.pid),hwnd:Number(win.hwnd),
            verified:true,shellInputSent:false};
        }
        const ide = appGate(caps, at.at?.process, {title: at.at?.window?.name, mode: 'input'}).cls === 'ide' ? classifyIdeClick(at.at?.elem) : null;
        // 0.5.2 R-01: deleting/erasing data inside any app needs consent; an unrecognised button in an «Are you sure» dialog is refused.
        const dz = x === pts[0][0] && y === pts[0][1] ? classifyDestructiveClick(at.at, args.action) : null;
        if (dz?.refuse) throw Error(`destructive_confirm_refused: ${dz.reason} — NEXUS cannot tell what this button in a deletion confirmation does; ask the owner to answer the dialog`);
        const pg = policy({proc: at.at?.process, title: at.at?.window?.name, mode: 'input', hwnd: at.at?.window?.hwnd, tool: 'mouse_action', args,
          opts: {policyOk}, legacy: 'target_not_allowed', el: at.at?.elem,
          extra: ide?.level === 3 ? {level: 3, what: 'arbitrary_command', via: ide.via} : dz ? {level: 2, what: dz.what, via: dz.via} : null});
        if (pg) return pg;
        target = {process: at.at.process, pid: at.at.pid, control: at.at.controlType, name: at.at.elem?.name, isPassword: at.at.elem?.isPassword !== false};
        lastAt = at.at;
      }
      const c = classifyClick(args.action, lastAt);
      if (c && consented) {
        if (String(lastAt.window?.hwnd) !== consented.hwnd || (consented.rid && lastAt.tab?.rid && lastAt.tab.rid !== consented.rid)) throw Error('consent_target_changed');
      } else if (c) {
        const g = consent.gate(c, lastAt.window, lastAt.tab, {tool: 'mouse_action', args});
        if (g) return g;
      }
      await ownerGuard();
      const R = getRobot();
      const cmd = {move: `move ${args.x} ${args.y}`, click: `click ${args.x} ${args.y} left 1`, double_click: `click ${args.x} ${args.y} left 2`,
        right_click: `click ${args.x} ${args.y} right 1`, scroll: `scroll ${args.x} ${args.y} ${args.amount}`, drag: `drag ${args.x} ${args.y} ${args.x2} ${args.y2}`}[args.action];
      await R.cmd(cmd);
      if (args.action === 'click' && c === null && lastAt?.nativeBubble?.verified === true &&
          lastAt.elem?.className === 'ImageButton' && /^(?:Закрыть|Close)$/i.test(lastAt.elem?.name || '')) {
        consent.noteNativeDismiss?.(lastAt.nativeBubble);
      }
      if (c && consented && decision === 'close_discard') consent.armDiscard(lastAt.window?.hwnd);
      const after = await uia({mode: 'focused'});
      await afterInput(after.focused);
      return {done: true, action: args.action, target, foregroundAfter: after.focused?.process || null, ...(c ? {closeAction: c.kind, consented: !!consented} : {})};
    },

    async keyboard_action(args, {consented = null, decision = null, policyOk = null} = {}) {
      requireCap(caps, 'gui_input'); winOnly();
      if (!onlyKeys(args, ['text', 'keys'])) bad();
      const hasText = typeof args.text === 'string', hasKeys = typeof args.keys === 'string';
      if (hasText === hasKeys) bad();
      if (hasText && (args.text.length < 1 || args.text.length > 4000)) bad();
      if (hasKeys && !/^(?:(?:ctrl|shift|alt)\+){0,3}(?:enter|tab|esc|backspace|delete|space|up|down|left|right|home|end|pageup|pagedown|f(?:[1-9]|1[0-2])|[a-z0-9])$/.test(args.keys)) bad();
      if (hasKeys && /^(?=.*ctrl)(?=.*alt)/.test(args.keys)) bad(); // Ctrl+Alt+… = AltGr / system chords: refused
      const before = await uia({mode: 'context'});
      if (!before.focused?.ok) throw Error('focus_not_allowed');
      // Never forward widget text, clipboard or keys into a password/PIN field.
      if (before.elem?.isPassword === true) throw Error('protected_input_refused');
      if (hasText && /(?:Edit|Document|ComboBox)/i.test(String(before.elem?.controlType||'')) && before.elem?.isPassword !== false)
        throw Error('protected_input_unverified');
      if (nexusWin && before.window?.hwnd && String(before.window.hwnd) !== nexusWin.hwnd && before.focused.pid !== nexusWin.pid) {
        try { onOwnerActive('foreground'); } catch { /* the refusal below still holds */ }
        throw Error(`owner_active: the foreground window is now ${before.focused.process || 'another app'}, switched not by NEXUS (the owner may be working there) - typing refused; ${OWNER_HINT}; after that, take your window back with focus_window (pid ${nexusWin.pid ?? '?'})`);
      }
      {
        const title = before.window?.name;
        const ide = appGate(caps, before.focused.process, {title, mode: 'input'}).cls === 'ide'
          ? classifyIdeInput({keys: hasKeys ? args.keys : null, text: hasText ? args.text : undefined, elem: before.elem}) : null;
        const dz = hasKeys ? classifyDestructiveKeys(args.keys, before) : null; // 0.5.2 R-01
        if (dz?.refuse) throw Error(`destructive_confirm_refused: ${dz.reason} — NEXUS cannot tell what the focused button in a deletion confirmation does; ask the owner to answer the dialog`);
        const pg = policy({proc: before.focused.process, title, mode: 'input', hwnd: before.window?.hwnd, tool: 'keyboard_action', args,
          opts: {policyOk}, legacy: 'focus_not_allowed', el: before.elem,
          extra: ide?.level === 3 ? {level: 3, what: 'arbitrary_command', via: ide.via} : dz ? {level: 2, what: dz.what, via: dz.via} : null});
        if (pg) return pg;
      }
      const c = hasKeys ? classifyKeys(args.keys, before) : null;
      if (c && consented) {
        const sel = (before.window?.tabs || []).find(t => t.selected);
        if (String(before.window?.hwnd) !== consented.hwnd || (consented.rid && sel?.rid !== consented.rid)) throw Error('consent_target_changed');
      } else if (c) {
        const g = consent.gate(c, before.window, null, {tool: 'keyboard_action', args});
        if (g) return g;
      }
      const agentApp = classifyApp(before.focused.process).cls === 'agent';
      const creating = hasKeys && NEW_KEYS.has(args.keys) && before.window?.process;
      const snap = creating ? await apps(before.window.process).catch(() => null) : null;
      await ownerGuard();
      const R = getRobot();
      let r;
      if (hasText && typer) {
        try { await typer(args.text); r = {clipboardRestored: true, clipboard: 'untouched', method: 'keys'}; }
        catch (e) { r = {...(await R.cmd('paste ' + Buffer.from(args.text, 'utf8').toString('base64'))), method: 'clipboard', keysError: String(e.message).slice(0, 60)}; }
      } else r = hasText ? {...(await R.cmd('paste ' + Buffer.from(args.text, 'utf8').toString('base64'))), method: 'clipboard'} : await R.cmd('key ' + args.keys);
      if (c && consented && decision === 'close_discard') consent.armDiscard(before.window?.hwnd);
      let created;
      if (creating) { await sleep(700); created = consent.recordCreated(snap, await apps(before.window.process).catch(() => null), 'keys:' + args.keys); }
      const after = await uia({mode: 'focused'});
      await afterInput(after.focused);
      return {done: true, target: before.focused.process, foregroundAfter: after.focused?.process || null,
        ...(hasText ? {chars: args.text.length, clipboardRestored: r.clipboardRestored, ...(r.clipboard ? {clipboard: r.clipboard} : {}), inputMethod: r.method, ...(r.keysError ? {keysError: r.keysError} : {})} : {keys: args.keys}),
        ...(c ? {closeAction: c.kind, consented: !!consented} : {}), ...(created ? {createdByNexus: created} : {}),
        ...(agentApp ? {agentPrompt: {app: before.focused.process, chars: hasText ? args.text.length : 0, preview: hasText ? redactSecrets(args.text.slice(0, 300)).text : 'keys:' + args.keys}} : {})};
    },
  };
  return api;
}
