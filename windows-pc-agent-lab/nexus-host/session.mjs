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
  'mouse_action', 'keyboard_action', 'focus_window', 'open_app', 'confirm_action', 'close_window',
  'browser_open', 'browser_action', 'browser_tabs', 'process_action', 'run_task',
]));
/** Tools that may run during a session and renew it, but never start one. */
export const RENEW_TOOLS = Object.freeze(new Set(['inspect_ui', 'window_info', 'capture_screen', 'browser_snapshot', 'list_windows', 'task_status']));

export const DEFAULTS = Object.freeze({idleMs: 45_000, maxMs: 30 * 60_000, tickMs: 1000, ownerStopMs: 10 * 60_000});

/** Owner requirement 02.11 (VISIBILITY): plain, secret-free journal line parts. */
const SAFE = v => (typeof v === 'string' && /^[A-Za-z0-9._ -]{1,40}$/.test(v) ? v : null);

export function createSession({caps, audit = () => {}, now = () => Date.now(), setIntervalFn = setInterval, clearIntervalFn = clearInterval,
  idleMs = DEFAULTS.idleMs, maxMs = DEFAULTS.maxMs, tickMs = DEFAULTS.tickMs, ownerStopMs = DEFAULTS.ownerStopMs} = {}) {
  let s = null;            // current session or null
  let last = null;         // summary of the last ended session
  let ownerLiveOptOut = false;
  const hooks = [];        // {fn: async (reason, session) => partial report, name}
  let stoppedUntil = 0;     // owner pressed STOP on the Live View page: no new work until then (or until resumed)
  const activity = [];     // last tool calls: {t, tool, ok, code?, target?} — names and codes only, never arguments
  const holds = new Map(); // 0.5.2 N-03: key → {until, pauseLive} — an owner action is pending; the idle lease must not end the task

  const timer = setIntervalFn(() => { tick().catch(() => {}); }, tickMs);
  timer?.unref?.();

  function begin(tool, kind = 'gui') {
    if (s) return s;
    s = {id: crypto.randomBytes(6).toString('hex'), kind, startedAt: now(), lastWork: now(), inflight: 0, calls: 0,
      live: caps.live_view === true && !ownerLiveOptOut, firstTool: tool};
    audit({event: 'session_start', session: s.id, kind, tool, live: s.live});
    return s;
  }

  /**
   * 0.5.2 N-07: `receivedAt` = when the Host got the trigger (e.g. notifications/cancelled arrived). The moment the owner
   * pressed Stop is NOT visible to the Host: full latency = (receivedAt − owner's own timestamp) + timing.hostTotalMs.
   */
  async function end(reason, {receivedAt = null} = {}) {
    if (!s) return {ended: false, reason, active: false};
    const t0 = Number.isFinite(receivedAt) ? receivedAt : now();
    const cur = s; s = null; // live goes off synchronously: no frame can be produced after this line
    const tLive = now();
    holds.clear();
    const report = {ended: true, session: cur.id, reason, sec: Math.round((now() - cur.startedAt) / 1000), calls: cur.calls};
    const hooksMs = {};
    for (const h of hooks) {
      const th = now();
      try { Object.assign(report, await h.fn(reason, cur)); } catch (e) { (report.hookErrors ||= []).push(String(e?.message || e).slice(0, 120)); }
      hooksMs[h.name] = now() - th;
    }
    const tDone = now();
    const {liveLastFrameAt = null, liveFramesDropped = 0} = report;
    delete report.liveLastFrameAt; delete report.liveFramesDropped;
    report.timing = {trigger: reason, receivedAt: new Date(t0).toISOString(), liveOffMs: tLive - t0, cleanupMs: tDone - tLive, hostTotalMs: tDone - t0,
      hooksMs, lastFrameAt: liveLastFrameAt ? new Date(liveLastFrameAt).toISOString() : null, framesAfterStop: 0, framesDroppedInFlight: liveFramesDropped,
      ...(reason === 'lease_expired' ? {idleDetectLagMs: Math.max(0, t0 - (cur.lastWork + idleMs))} : {}),
      ownerPress: 'not visible to the Host — full Stop latency = (receivedAt − owner timestamp from stopwatch/screen recording) + hostTotalMs'};
    if (liveLastFrameAt && liveLastFrameAt > t0) report.timing.framesAfterStop = 1; // must stay 0: frames after the trigger are a defect
    last = {...report, endedAt: new Date(now()).toISOString()};
    audit({event: 'session_end', ...report});
    return {...report, active: false, liveActive: false};
  }

  async function tick() {
    if (!s) return;
    const t = now();
    for (const [k, h] of holds) if (h.until < t) holds.delete(k);
    if (s.inflight === 0 && holds.size === 0 && t - s.lastWork > idleMs) await end('lease_expired');
    else if (t - s.startedAt > maxMs) await end('max_duration');
  }

  return {
    /** Wrap one tool call. Starts the session for WORK_TOOLS, renews it for RENEW_TOOLS during a session. */
    async around(tool, fn) {
      const starts = WORK_TOOLS.has(tool), renews = starts || (s && RENEW_TOOLS.has(tool));
      if (starts && stoppedUntil > now()) {
        throw Error(`stopped_by_owner: the owner pressed STOP on Live View ${Math.round((now() - (stoppedUntil - ownerStopMs)) / 1000)} s ago - do not continue the task; wait for the owner to say in chat that you may continue`);
      }
      if (!renews) return fn();
      const cur = starts ? begin(tool) : s;
      cur.inflight++; cur.calls++; cur.lastWork = now();
      try { return await fn(); } finally { cur.inflight--; cur.lastWork = now(); }
    },
    /** watch_nexus without a task: a watch-only session, same lease (frames do not renew it). */
    beginWatch() { ownerLiveOptOut = false; const cur = begin('watch_nexus', 'watch'); cur.live = caps.live_view === true; cur.lastWork = now(); return cur; },
    end,
    tick,
    /** Owner requirement 02.11: STOP from the phone (Live View page) stops the TASK, not only the picture. */
    async ownerStop() {
      stoppedUntil = now() + ownerStopMs;
      audit({event: 'owner_stop', blockSec: Math.round(ownerStopMs / 1000)});
      return end('owner_stop');
    },
    resumeAfterStop() { const was = stoppedUntil > now(); stoppedUntil = 0; if (was) audit({event: 'owner_stop_cleared'}); return was; },
    stoppedByOwner: () => stoppedUntil > now(),
    /** One journal line per tool call (owner can see what runs, its result and where it failed). */
    note({tool, ok, code = null, target = null}) {
      const e = {t: now(), tool: SAFE(tool) || 'tool', ok: !!ok};
      const c = typeof code === 'string' ? code.split(':')[0] : null; if (SAFE(c)) e.code = c;
      if (SAFE(target)) e.target = target;
      activity.push(e); if (activity.length > 20) activity.shift();
    },
    activity: (n = 10) => activity.slice(-n).map(e => ({...e, t: new Date(e.t).toISOString()})),
    /** ASCII caption burned into Live View frames: what NEXUS did last, on what, result. */
    caption() {
      const e = activity[activity.length - 1];
      const head = stoppedUntil > now() ? 'NEXUS - STOPPED BY OWNER' : s ? 'NEXUS working' : 'NEXUS idle';
      if (!e) return head;
      const ago = Math.max(0, Math.round((now() - e.t) / 1000));
      return `${head} | ${e.tool}${e.target ? ' -> ' + e.target : ''} | ${e.ok ? 'ok' : 'ERROR ' + (e.code || '')} | ${ago}s ago`;
    },
    onEnd(h, name = 'hook' + (hooks.length + 1)) { hooks.push({fn: h, name}); },
    /** Owner said "no Live View" — respected until the owner asks to watch again. */
    optOutLive() { ownerLiveOptOut = true; if (s) s.live = false; },
    /** 0.5.2: an owner action is pending — keep the session (bounded by `ms`); optionally stop Live View frames meanwhile. */
    hold(key, ms, {pauseLive = true} = {}) { if (!s) return false; holds.set(key, {until: now() + ms, pauseLive}); return true; },
    release(key) { const had = holds.delete(key); if (s && had) s.lastWork = now(); return had; },
    liveActive: () => !!s && s.live && caps.live_view === true && ![...holds.values()].some(h => h.pauseLive),
    active: () => !!s,
    status: () => ({
      active: !!s, liveActive: !!s && s.live && caps.live_view === true && ![...holds.values()].some(h => h.pauseLive), ownerLiveOptOut,
      ...(holds.size ? {heldFor: [...holds.keys()]} : {}),
      ...(s ? {session: s.id, kind: s.kind, sinceSec: Math.round((now() - s.startedAt) / 1000),
        idleSec: Math.round((now() - s.lastWork) / 1000), inflight: s.inflight, expiresInSec: Math.max(0, Math.round((idleMs - (now() - s.lastWork)) / 1000))} : {}),
      leaseIdleSec: idleMs / 1000, lastEnded: last,
      ...(stoppedUntil > now() ? {stoppedByOwner: true, stopBlocksSec: Math.round((stoppedUntil - now()) / 1000)} : {}),
      activity: activity.slice(-5).map(e => ({...e, t: new Date(e.t).toISOString()})),
    }),
    stop() { clearIntervalFn(timer); },
  };
}
