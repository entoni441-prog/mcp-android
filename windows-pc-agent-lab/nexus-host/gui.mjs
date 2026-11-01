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
import {requireCap, isHardDenied} from './capabilities.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROBOT_SRC = path.join(HERE, 'NexusRobot.java');
const MAX_IMAGE_W = 1568;
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
export function runUiaReal(args, {systemRoot = process.env.SystemRoot, tmpDir, timeoutMs = 20_000} = {}) {
  if (typeof systemRoot !== 'string' || !/^[a-zA-Z]:\\/.test(systemRoot)) throw Error('invalid_windows_system_root');
  const exe = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  fs.mkdirSync(tmpDir, {recursive: true});
  const out = path.join(tmpDir, 'uia-' + crypto.randomBytes(8).toString('hex') + '.json');
  const encoded = Buffer.from(UIA_SCRIPT, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const p = spawn(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
      env: {...process.env, NEXUS_UIA_ARGS: JSON.stringify(args), NEXUS_UIA_OUT: out},
    });
    let err = '';
    const timer = setTimeout(() => { p.kill(); reject(Error('uia_timeout')); }, timeoutMs);
    p.stderr.on('data', c => { if (err.length < 2000) err += c; });
    p.once('error', () => { clearTimeout(timer); reject(Error('powershell_launch_failed')); });
    p.once('exit', code => {
      clearTimeout(timer);
      try {
        if (code !== 0 || !fs.existsSync(out)) return reject(Object.assign(Error('uia_failed'), {detail: err.slice(0, 500)}));
        resolve(JSON.parse(fs.readFileSync(out, 'utf8').replace(/^﻿/, '')));
      } catch { reject(Error('uia_bad_output')); } finally { fs.rmSync(out, {force: true}); }
    });
  });
}

// ───────────── coordinate mapping ─────────────
export function mapping(info, root) {
  if (!info || !root || info.screens !== 1) return null;
  if (!(info.w > 0 && info.h > 0 && root.w > 0 && root.h > 0)) return null;
  const rx = root.w / info.w, ry = root.h / info.h;
  return {
    rx, ry,
    toUia: (x, y) => ({x: Math.round(root.x + (x - info.x) * rx), y: Math.round(root.y + (y - info.y) * ry)}),
    rectToScreen: r => r && ({x: Math.round(info.x + (r.x - root.x) / rx), y: Math.round(info.y + (r.y - root.y) / ry), w: Math.round(r.w / rx), h: Math.round(r.h / ry)}),
  };
}

const allowedApp = (caps, name) => typeof name === 'string' && name !== '' && !isHardDenied(name) &&
  caps.inputApps.some(a => a.toLowerCase() === name.toLowerCase());

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
export function createGui({caps, home, workspace, platform = process.platform, runUia, robot}) {
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

  async function checkPid(pid) {
    const r = await uia({mode: 'windows', pid});
    if (!allowedApp(caps, r.target?.process)) throw Error('app_not_allowed');
    return r;
  }

  return {
    warm() { if (caps.gui_input || caps.screen_capture) getRobot().start().catch(() => {}); },
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
        const r = await getRobot().cmd(`capture ${maxW} ${Buffer.from(file).toString('base64')}`);
        const png = fs.readFileSync(file);
        let saved = null;
        if (args.saveToWorkspace) {
          const dir = path.join(workspace, 'screenshots'); fs.mkdirSync(dir, {recursive: true});
          saved = 'screenshots/' + new Date().toISOString().replace(/[:.]/g, '-') + '.png';
          fs.writeFileSync(path.join(workspace, ...saved.split('/')), png, {flag: 'wx'});
        }
        const meta = {imageW: r.imageW, imageH: r.imageH, screenW: r.screenW, screenH: r.screenH,
          imageToScreen: +(r.screenW / r.imageW).toFixed(4), distinctColours: r.colours, pngBytes: png.length, ms: r.ms, savedTo: saved};
        return {content: [{type: 'image', data: png.toString('base64'), mimeType: 'image/png'}, {type: 'text', text: JSON.stringify(meta)}], structured: meta};
      } finally { fs.rmSync(file, {force: true}); }
    },

    async window_info(args) {
      requireCap(caps, 'ui_read'); winOnly();
      if (!onlyKeys(args, ['pid']) || !int(args.pid, 1, 2 ** 31)) bad();
      const r = await checkPid(args.pid);
      const m = mapping(await info(), r.root);
      return {pid: args.pid, process: r.target.process, foreground: r.focused?.pid === args.pid, coordinateMapping: !!m,
        windows: (r.windows || []).slice(0, 20).map(w => ({name: String(w.name || '').slice(0, 200), className: w.className, rect: m ? m.rectToScreen(w.rect) : null}))};
    },

    async inspect_ui(args) {
      requireCap(caps, 'ui_read'); winOnly();
      if (!onlyKeys(args, ['pid', 'maxDepth', 'maxNodes']) || !int(args.pid, 1, 2 ** 31)) bad();
      const depth = args.maxDepth ?? 4, max = args.maxNodes ?? 150;
      if (!int(depth, 1, 8) || !int(max, 1, 400)) bad();
      const r = await uia({mode: 'tree', pid: args.pid, depth, max});
      if (!allowedApp(caps, r.target?.process)) throw Error('app_not_allowed');
      const m = mapping(await info(), r.root);
      const fix = n => ({...n, rect: m ? m.rectToScreen(n.rect) : null, ...(n.children ? {children: n.children.map(fix)} : {})});
      return {pid: args.pid, process: r.target.process, nodes: r.nodes, coordinateMapping: !!m, tree: (r.tree || []).map(fix)};
    },

    async focus_window(args) {
      requireCap(caps, 'ui_read'); winOnly();
      if (!onlyKeys(args, ['pid']) || !int(args.pid, 1, 2 ** 31)) bad();
      const w = await checkPid(args.pid);
      if (!w.windows?.length) throw Error('window_not_found');
      if (w.focused?.pid === args.pid) return {focused: true, already: true, method: 'none'};
      const r = await uia({mode: 'activate', pid: args.pid, title: String(w.windows[0].name || '').slice(0, 200)});
      const ok = r.focused?.ok === true && r.focused.pid === args.pid;
      return {focused: ok, method: r.appActivateByPid ? 'AppActivate(pid)' : r.appActivateByTitle ? 'AppActivate(title)' : 'none',
        foregroundProcess: r.focused?.process || null,
        hint: ok ? undefined : 'Focus not confirmed. Use mouse_action click inside the window (requires gui_input).'};
    },

    async mouse_action(args) {
      requireCap(caps, 'gui_input'); winOnly();
      if (!onlyKeys(args, ['action', 'x', 'y', 'x2', 'y2', 'amount'])) bad();
      const A = ['move', 'click', 'double_click', 'right_click', 'scroll', 'drag'];
      if (!A.includes(args.action) || !int(args.x, -20000, 20000) || !int(args.y, -20000, 20000)) bad();
      const pts = [[args.x, args.y]];
      if (args.action === 'drag') { if (!int(args.x2, -20000, 20000) || !int(args.y2, -20000, 20000)) bad(); pts.push([args.x2, args.y2]); }
      else if (args.x2 !== undefined || args.y2 !== undefined) bad();
      if (args.action === 'scroll') { if (!int(args.amount, -20, 20) || args.amount === 0) bad(); } else if (args.amount !== undefined) bad();
      const inf = await info();
      if (inf.screens !== 1) throw Error('multi_monitor_unsupported');
      let target = null;
      if (!rootCache) rootCache = (await uia({mode: 'focused'})).root;
      for (const [x, y] of pts) {
        const m = mapping(inf, rootCache); if (!m) throw Error('coordinate_mapping_failed');
        const u = m.toUia(x, y);
        const at = await uia({mode: 'at', x: u.x, y: u.y});
        if (JSON.stringify(at.root) !== JSON.stringify(rootCache)) { rootCache = at.root; infoCache = null; throw Error('screen_changed_retry'); }
        if (!allowedApp(caps, at.at?.process)) throw Error('target_not_allowed');
        target = {process: at.at.process, pid: at.at.pid, control: at.at.controlType};
      }
      const R = getRobot();
      const cmd = {move: `move ${args.x} ${args.y}`, click: `click ${args.x} ${args.y} left 1`, double_click: `click ${args.x} ${args.y} left 2`,
        right_click: `click ${args.x} ${args.y} right 1`, scroll: `scroll ${args.x} ${args.y} ${args.amount}`, drag: `drag ${args.x} ${args.y} ${args.x2} ${args.y2}`}[args.action];
      await R.cmd(cmd);
      const after = await uia({mode: 'focused'});
      return {done: true, action: args.action, target, foregroundAfter: after.focused?.process || null};
    },

    async keyboard_action(args) {
      requireCap(caps, 'gui_input'); winOnly();
      if (!onlyKeys(args, ['text', 'keys'])) bad();
      const hasText = typeof args.text === 'string', hasKeys = typeof args.keys === 'string';
      if (hasText === hasKeys) bad();
      if (hasText && (args.text.length < 1 || args.text.length > 4000)) bad();
      if (hasKeys && !/^(?:(?:ctrl|shift|alt)\+){0,3}(?:enter|tab|esc|backspace|delete|space|up|down|left|right|home|end|pageup|pagedown|f(?:[1-9]|1[0-2])|[a-z0-9])$/.test(args.keys)) bad();
      if (hasKeys && /^(?=.*ctrl)(?=.*alt)/.test(args.keys)) bad(); // Ctrl+Alt+… = AltGr / system chords: refused
      const before = await uia({mode: 'focused'});
      if (!before.focused?.ok || !allowedApp(caps, before.focused.process)) throw Error('focus_not_allowed');
      const R = getRobot();
      const r = hasText ? await R.cmd('paste ' + Buffer.from(args.text, 'utf8').toString('base64')) : await R.cmd('key ' + args.keys);
      const after = await uia({mode: 'focused'});
      return {done: true, target: before.focused.process, foregroundAfter: after.focused?.process || null, ...(hasText ? {chars: args.text.length, clipboardRestored: r.clipboardRestored} : {keys: args.keys})};
    },
  };
}
