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
  'mouse_action', 'keyboard_action', 'focus_window', 'open_app', 'confirm_action', 'close_window', 'minimize_window',
  'browser_open', 'browser_action', 'browser_tabs', 'process_action', 'run_task',
]));
/** Tools that may run during a session and renew it, but never start one. */
export const RENEW_TOOLS = Object.freeze(new Set(['inspect_ui', 'window_info', 'capture_screen', 'browser_snapshot', 'list_windows', 'task_status', 'run_command', 'command_plan', 'system_info', 'files_scoped', 'download_verify', 'get_capabilities']));

/**
 * NEXUS NEXT: while a TASK is open (tasks.peek().status === 'active') the lease is the task heartbeat — any tool call,
 * read-only included, renews it; up to taskIdleMs (10 min) without calls, then the session ends with reason
 * 'view_idle' (task interrupted, resumable). Without a task (watch-only) the 45 s lease stays. Frames never renew.
 * STOP (owner, Live View page) is STICKY: no timer lifts it; only live_control resume (after the owner's go-ahead in
 * chat) does. It is persisted (stopStore) so a Host restart cannot silently lift it.
 */
export const DEFAULTS = Object.freeze({idleMs: 45_000, taskIdleMs: 10 * 60_000, maxMs: 4 * 3600_000, tickMs: 1000, ownerStopMs: Infinity});
/** Why there is no work session right now — what get_capabilities/connection report (FR-01.2). */
export const SESSION_STATES = Object.freeze(['active', 'owner_paused', 'owner_stop', 'view_idle', 'lease_expired', 'idle']);

/** Owner requirement 02.11 (VISIBILITY): plain, secret-free journal line parts. */
const SAFE = v => (typeof v === 'string' && /^[A-Za-z0-9._ -]{1,40}$/.test(v) ? v : null);

export function createSession({caps, audit = () => {}, now = () => Date.now(), setIntervalFn = setInterval, clearIntervalFn = clearInterval,
  idleMs = DEFAULTS.idleMs, taskIdleMs = DEFAULTS.taskIdleMs, maxMs = DEFAULTS.maxMs, tickMs = DEFAULTS.tickMs, ownerStopMs = DEFAULTS.ownerStopMs,
  stopStore = null} = {}) {
  let taskActive = () => false; // set by the runtime (tasks.peek)
  let s = null;            // current session or null
  let last = null;         // summary of the last ended session
  let ownerLiveOptOut = false;
  const hooks = [];        // {fn: async (reason, session) => partial report, name}
  let stoppedUntil = 0;     // owner pressed STOP on the Live View page: no new work until resumed (sticky, NEXT)
  let stoppedAt = 0;
  try { const p = stopStore?.load?.(); if (p && p.stopped) { stoppedUntil = Infinity; stoppedAt = Date.parse(p.at) || now(); } } catch { /* unreadable marker → not stopped */ }
  const activity = [];     // last tool calls: {t, tool, ok, code?, target?} — names and codes only, never arguments
  let ownerPause = null;    // revision 2: the owner took over the PC → {since, why}; ends ONLY by explicit resume
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
    const tasky = s.kind !== 'watch' && taskActive();
    if (s.inflight === 0 && holds.size === 0 && t - s.lastWork > (tasky ? taskIdleMs : idleMs)) await end(tasky ? 'view_idle' : 'lease_expired');
    else if (t - s.startedAt > maxMs) await end('max_duration');
  }

  return {
    /** Wrap one tool call. Starts the session for WORK_TOOLS, renews it for RENEW_TOOLS during a session. */
    async around(tool, fn) {
      const starts = WORK_TOOLS.has(tool), renews = starts || (s && RENEW_TOOLS.has(tool));
      if (starts && stoppedUntil > now()) {
        throw Error(`stopped_by_owner: the owner pressed STOP ${Math.round((now() - stoppedAt) / 1000)} s ago - the task is stopped and will NOT resume by itself; continue only after the owner explicitly says so in chat, then call live_control resume`);
      }
      if (starts && ownerPause) {
        throw Error(`owner_paused: the owner took over the PC ${Math.round((now() - ownerPause.since) / 1000)} s ago (${ownerPause.why}) - NEXUS does nothing on the desktop until the owner explicitly says to continue; ask the owner, then call live_control resume`);
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
      stoppedUntil = now() + ownerStopMs; stoppedAt = now();
      try { stopStore?.save?.({stopped: true, at: new Date(stoppedAt).toISOString()}); } catch { /* in-memory block still holds */ }
      audit({event: 'owner_stop', sticky: !Number.isFinite(ownerStopMs)});
      return end('owner_stop');
    },
    resumeAfterStop() { const was = stoppedUntil > now(); stoppedUntil = 0; try { stopStore?.save?.(null); } catch {} if (was) audit({event: 'owner_stop_cleared'}); return was; },
    /** Runtime wiring: is a task open (heartbeat lease applies)? */
    setTaskActive(fn) { taskActive = typeof fn === 'function' ? fn : () => false; },
    /** FR-01.2: one word for why the desktop is (not) being worked on. */
    state() {
      if (stoppedUntil > now()) return 'owner_stop';
      if (ownerPause) return 'owner_paused';
      if (s) return 'active';
      return last?.reason === 'view_idle' ? 'view_idle' : last?.reason === 'lease_expired' ? 'lease_expired' : 'idle';
    },
    /** Revision 2: the owner moved the mouse / switched the window. Sticky: no timer, no idle heuristic ends it. */
    pauseForOwner(why = 'owner') {
      if (ownerPause) return false;
      ownerPause = {since: now(), why: SAFE(why) || 'owner'};
      audit({event: 'owner_pause', why: ownerPause.why});
      return true;
    },
    /** Explicit continuation (live_control resume after the owner's go-ahead). */
    resumeOwner() { const was = !!ownerPause; if (was) audit({event: 'owner_pause_cleared', sec: Math.round((now() - ownerPause.since) / 1000)}); ownerPause = null; return was; },
    ownerPaused: () => !!ownerPause,
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
      const head = stoppedUntil > now() ? 'NEXUS - STOPPED BY OWNER' : ownerPause ? 'NEXUS - PAUSED, OWNER AT PC' : s ? 'NEXUS working' : 'NEXUS idle';
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
        idleSec: Math.round((now() - s.lastWork) / 1000), inflight: s.inflight, expiresInSec: Math.max(0, Math.round(((s.kind !== 'watch' && taskActive() ? taskIdleMs : idleMs) - (now() - s.lastWork)) / 1000))} : {}),
      state: (stoppedUntil > now() ? 'owner_stop' : ownerPause ? 'owner_paused' : s ? 'active' : last?.reason === 'view_idle' ? 'view_idle' : last?.reason === 'lease_expired' ? 'lease_expired' : 'idle'),
      leaseIdleSec: (s && s.kind !== 'watch' && taskActive() ? taskIdleMs : idleMs) / 1000, lastEnded: last,
      ...(ownerPause ? {ownerPaused: {why: ownerPause.why, sinceSec: Math.round((now() - ownerPause.since) / 1000), resume: 'live_control resume, only after the owner said to continue'}} : {}),
      ...(stoppedUntil > now() ? {stoppedByOwner: true, stopSinceSec: Math.round((now() - stoppedAt) / 1000), resume: 'live_control resume, only after the owner said to continue'} : {}),
      activity: activity.slice(-5).map(e => ({...e, t: new Date(e.t).toISOString()})),
    }),
    stop() { clearIntervalFn(timer); },
  };
}
