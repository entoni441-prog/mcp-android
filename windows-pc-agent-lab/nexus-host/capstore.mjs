/**
 * NEXUS Host 0.4.1 — live capability store.
 *  - Host re-reads capabilities.json without restart: before every tools/call and every 2 s.
 *  - A broken or invalid file is NEVER applied: current permissions stay, the error is audited (fail-safe).
 *  - set(): owner-instructed switch from chat (tool set_capability). Only keys in SETTABLE; written atomically
 *    (temp file + rename), so a crash cannot leave a half-written file.
 *  - Every effective change is audited: {event:'capabilities_changed', source, changes:{key:[old,new]}}.
 * Modules receive `view` — a live read-only proxy, so they always see current values.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {validateCapabilities} from './capabilities.mjs';

export const SETTABLE = Object.freeze(['gui_input', 'live_view']);
const FLAGS = ['screen_capture', 'ui_read', 'gui_input', 'process_control', 'run_task', 'browser', 'live_view', 'grantsFromChat'];

function diff(a, b) {
  const changes = {};
  for (const k of FLAGS) if (a[k] !== b[k]) changes[k] = [a[k], b[k]];
  if (JSON.stringify(a.inputApps) !== JSON.stringify(b.inputApps)) changes.inputApps = [a.inputApps, b.inputApps];
  if (JSON.stringify(a.tasks) !== JSON.stringify(b.tasks)) changes.tasks = [Object.keys(a.tasks), Object.keys(b.tasks)];
  if (JSON.stringify(a.launchApps) !== JSON.stringify(b.launchApps)) changes.launchApps = [Object.keys(a.launchApps || {}), Object.keys(b.launchApps || {})];
  for (const k of ['javaPath', 'edgePath']) if (a[k] !== b[k]) changes[k] = [a[k], b[k]];
  return changes;
}

export function createCapStore({file, initial, audit = () => {}, intervalMs = 2000}) {
  let caps = initial;
  let stamp = file && fs.existsSync(file) ? stampOf(file) : null;
  let lastError = null;
  let timer = null;

  function stampOf(f) { const st = fs.statSync(f); return `${st.mtimeMs}:${st.size}`; }

  function apply(next, source) {
    const changes = diff(caps, next);
    caps = next;
    if (Object.keys(changes).length) audit({event: 'capabilities_changed', source, changes});
    return changes;
  }

  /** Re-read the file if it changed on disk. Invalid → keep current permissions, audit once per bad version. */
  function refresh(source = 'file') {
    if (!file) return caps;
    let s;
    try { s = stampOf(file); } catch { if (lastError !== 'missing') { lastError = 'missing'; audit({event: 'capabilities_reload_failed', error: 'file_missing', kept: 'current'}); } return caps; }
    if (s === stamp) return caps;
    stamp = s;
    try {
      const next = validateCapabilities(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')));
      lastError = null;
      apply(next, source);
    } catch (e) {
      lastError = String(e.message || e).slice(0, 200);
      audit({event: 'capabilities_reload_failed', error: lastError, kept: 'current'});
    }
    return caps;
  }

  /** Atomic read-modify-write of capabilities.json (temp file + rename); validates before writing. */
  function edit(mutate, source) {
    if (!file) throw Error('no_capabilities_file');
    refresh();
    if (lastError) throw Error('capabilities_file_invalid'); // never build on top of a broken file
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    mutate(raw);
    const next = validateCapabilities(raw);
    const tmp = path.join(path.dirname(file), '.capabilities-' + crypto.randomBytes(6).toString('hex') + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n', {flag: 'wx'});
    fs.renameSync(tmp, file);
    stamp = stampOf(file);
    return apply(next, source);
  }

  /** Owner-instructed switch (tool set_capability). */
  function set(key, value, source = 'tool') {
    if (!SETTABLE.includes(key) || typeof value !== 'boolean') throw Error('invalid_args');
    const previous = caps[key];
    edit(raw => { raw[key] = value; }, source);
    return {capability: key, enabled: value, previous, changed: previous !== value};
  }

  /** 0.5.0: owner-consented app access (manage_app_access → confirm_action allow) and revocation. */
  function grantApp(proc, launch, source = 'consent') {
    edit(raw => {
      const list = Array.isArray(raw.inputApps) ? raw.inputApps : [...caps.inputApps];
      if (!list.some(a => a.toLowerCase() === proc.toLowerCase())) list.push(proc);
      raw.inputApps = list;
      if (launch) raw.launchApps = {...(raw.launchApps || {}), [launch.name]: launch.exe};
    }, source);
    return {inputApps: caps.inputApps, launchApps: Object.keys(caps.launchApps || {})};
  }
  function revokeApp(proc, source = 'tool') {
    edit(raw => {
      raw.inputApps = (Array.isArray(raw.inputApps) ? raw.inputApps : [...caps.inputApps]).filter(a => a.toLowerCase() !== proc.toLowerCase());
      if (raw.launchApps) for (const k of Object.keys(raw.launchApps)) if (k === proc.toLowerCase()) delete raw.launchApps[k];
    }, source);
    return {inputApps: caps.inputApps, launchApps: Object.keys(caps.launchApps || {})};
  }

  const view = new Proxy({}, {
    get: (_, k) => caps[k],
    has: (_, k) => k in caps,
    ownKeys: () => Reflect.ownKeys(caps),
    getOwnPropertyDescriptor: (_, k) => ({...Object.getOwnPropertyDescriptor(caps, k), configurable: true}),
    set: () => false, defineProperty: () => false, deleteProperty: () => false,
  });

  return {
    view, refresh, set, grantApp, revokeApp,
    get: () => caps,
    status: () => ({...Object.fromEntries(FLAGS.map(k => [k, caps[k]])), inputApps: caps.inputApps, launchApps: Object.keys(caps.launchApps || {}), tasks: Object.keys(caps.tasks), fileError: lastError, settableFromChat: SETTABLE}),
    watch() { if (file && !timer) { timer = setInterval(() => refresh('file'), intervalMs); timer.unref?.(); } },
    stop() { clearInterval(timer); timer = null; },
  };
}
