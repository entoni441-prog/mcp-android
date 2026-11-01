/**
 * NEXUS Host 0.5.1 — work session (lease) separate from persistent owner grants.
 *
 *  Persistent grant  = capabilities.json flags (gui_input, live_view, browser…). Set by the owner, survive restarts.
 *  Active session    = a temporary lease that exists only while an agent is really working on the desktop.
 *
 *  - A session starts automatically on the first GUI-acting tool call (mouse/keyboard/focus/open_app/browser…), BEFORE
 *    that call runs, so Live View is already on when the first input happens (if the owner granted live_view and did
 *    not opt out).
 *  - The lease is renewed ONLY by real work (tool calls). Live View frames never renew it: a forgotten widget cannot
 *    keep the screen stream alive.
 *  - An in-flight tool call holds the lease (long calls cannot expire mid-operation).
 *  - The session ends on: finish_task (explicit), client cancellation (MCP notifications/cancelled), idle TTL
 *    (watchdog, default 45 s without work), hard maximum (default 30 min), Host shutdown. Ending is idempotent.
 *  - On end: Live View off on the SOURCE (no frames are produced any more), end hooks run (cleanup of NEXUS-owned
 *    windows/tabs/browser, cancellation of NEXUS-started tasks). Persistent grants are NOT revoked.
 *
 *  Why idle TTL is 45 s and not 10–15 s: reasoning models routinely think 15–40 s between tool calls; a shorter lease
 *  would switch Live View off and clean up windows in the middle of a normal task. Stop in ChatGPT ends the session
 *  immediately IF the client sends notifications/cancelled; otherwise the honest worst case is idleMs + tickMs.
 *  After Stop no new operations happen anyway, because every operation is driven by a tool call.
 */
import crypto from 'node:crypto';

/** Tools that act on (or open things on) the real desktop. Read-only tools do not start a session. */
export const WORK_TOOLS = Object.freeze(new Set([
  'mouse_action', 'keyboard_action', 'focus_window', 'open_app', 'confirm_action',
  'browser_open', 'browser_action', 'browser_tabs', 'process_action', 'run_task',
]));
/** Tools that may run during a session and renew it, but never start one. */
export const RENEW_TOOLS = Object.freeze(new Set(['inspect_ui', 'window_info', 'capture_screen', 'browser_snapshot', 'list_windows', 'task_status']));

export const DEFAULTS = Object.freeze({idleMs: 45_000, maxMs: 30 * 60_000, tickMs: 1000});

export function createSession({caps, audit = () => {}, now = () => Date.now(), setIntervalFn = setInterval, clearIntervalFn = clearInterval,
  idleMs = DEFAULTS.idleMs, maxMs = DEFAULTS.maxMs, tickMs = DEFAULTS.tickMs} = {}) {
  let s = null;            // current session or null
  let last = null;         // summary of the last ended session
  let ownerLiveOptOut = false;
  const hooks = [];        // async (reason, session) => partial report

  const timer = setIntervalFn(() => { tick().catch(() => {}); }, tickMs);
  timer?.unref?.();

  function begin(tool, kind = 'gui') {
    if (s) return s;
    s = {id: crypto.randomBytes(6).toString('hex'), kind, startedAt: now(), lastWork: now(), inflight: 0, calls: 0,
      live: caps.live_view === true && !ownerLiveOptOut, firstTool: tool};
    audit({event: 'session_start', session: s.id, kind, tool, live: s.live});
    return s;
  }

  async function end(reason) {
    if (!s) return {ended: false, reason, active: false};
    const cur = s; s = null; // live goes off synchronously: no frame can be produced after this line
    const report = {ended: true, session: cur.id, reason, sec: Math.round((now() - cur.startedAt) / 1000), calls: cur.calls};
    for (const h of hooks) {
      try { Object.assign(report, await h(reason, cur)); } catch (e) { (report.hookErrors ||= []).push(String(e?.message || e).slice(0, 120)); }
    }
    last = {...report, endedAt: new Date(now()).toISOString()};
    audit({event: 'session_end', ...report});
    return {...report, active: false, liveActive: false};
  }

  async function tick() {
    if (!s) return;
    const t = now();
    if (s.inflight === 0 && t - s.lastWork > idleMs) await end('lease_expired');
    else if (t - s.startedAt > maxMs) await end('max_duration');
  }

  return {
    /** Wrap one tool call. Starts the session for WORK_TOOLS, renews it for RENEW_TOOLS during a session. */
    async around(tool, fn) {
      const starts = WORK_TOOLS.has(tool), renews = starts || (s && RENEW_TOOLS.has(tool));
      if (!renews) return fn();
      const cur = starts ? begin(tool) : s;
      cur.inflight++; cur.calls++; cur.lastWork = now();
      try { return await fn(); } finally { cur.inflight--; cur.lastWork = now(); }
    },
    /** watch_nexus without a task: a watch-only session, same lease (frames do not renew it). */
    beginWatch() { ownerLiveOptOut = false; const cur = begin('watch_nexus', 'watch'); cur.live = caps.live_view === true; cur.lastWork = now(); return cur; },
    end,
    tick,
    onEnd(h) { hooks.push(h); },
    /** Owner said "no Live View" — respected until the owner asks to watch again. */
    optOutLive() { ownerLiveOptOut = true; if (s) s.live = false; },
    liveActive: () => !!s && s.live && caps.live_view === true,
    active: () => !!s,
    status: () => ({
      active: !!s, liveActive: !!s && s.live && caps.live_view === true, ownerLiveOptOut,
      ...(s ? {session: s.id, kind: s.kind, sinceSec: Math.round((now() - s.startedAt) / 1000),
        idleSec: Math.round((now() - s.lastWork) / 1000), inflight: s.inflight, expiresInSec: Math.max(0, Math.round((idleMs - (now() - s.lastWork)) / 1000))} : {}),
      leaseIdleSec: idleMs / 1000, lastEnded: last,
    }),
    stop() { clearIntervalFn(timer); },
  };
}
