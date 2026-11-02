/**
 * NEXUS Host 0.5.1 — Live View source (pull model).
 *  0.5.1: frames are gated by the ACTIVE SESSION (session.mjs), not only by the persistent grant `live_view`:
 *  grant=true + no active work session → state 'ready', no capture. Viewer requests never renew the session.
 *  - A frame is produced ONLY when a viewer asks for one (widget in ChatGPT or gateway /live page). No viewer → no capture.
 *  - Capability `live_view` (default false) gates every frame; it is separate from gui_input (watching ≠ controlling).
 *  - Frames are never written to disk beyond a temp file deleted immediately, never audited, never cached longer than 150 ms.
 *  - Rate limit: at most one capture per 200 ms (≤5 fps) shared by all viewers; concurrent requests share one capture.
 *  - Indicator: console line + console window title while frames are being served; audit records viewing start/stop
 *    (never the image or screen text).
 *  - STOP: live_control {action:'stop'} switches live_view off (lowering a privilege is always allowed).
 */
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (a, allowed) => isObj(a) && Object.keys(a).every(k => allowed.includes(k));
const bad = () => { throw Error('invalid_args'); };
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

export const MIN_INTERVAL_MS = 200;
export const IDLE_MS = 6000;

export function createLive({caps, store, capture, session = null, audit = () => {}, now = () => Date.now(), indicator = defaultIndicator, setIntervalFn = setInterval}) {
  let seq = 0, last = null, inflight = null, viewing = false, lastServed = 0, served = 0, since = 0;
  let lastFrameAt = 0, droppedAfterStop = 0; // 0.5.2 N-07: Stop timing marks
  const setViewing = (on, why) => {
    if (on === viewing) return;
    viewing = on;
    if (on) { since = now(); served = 0; }
    audit({event: 'live_view_viewing', on, why, ...(on ? {} : {frames: served, sec: Math.round((now() - since) / 1000)})});
    indicator(on);
  };
  const timer = setIntervalFn(() => { if (viewing && now() - lastServed > IDLE_MS) setViewing(false, 'idle'); }, 1000);
  timer?.unref?.();

  async function grab(maxW, quality) {
    const t = now();
    if (last && t - last.t < MIN_INTERVAL_MS && last.maxW === maxW && last.quality === quality) return last;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const {jpeg, meta} = await capture(maxW, quality);
        last = {jpeg, meta, t: now(), seq: ++seq, maxW, quality};
        return last;
      } finally { inflight = null; }
    })();
    return inflight;
  }

  const granted = () => caps.live_view === true;
  const allowed = () => granted() && (session ? session.liveActive() : true);
  const state = () => !granted() ? 'off' : allowed() ? (viewing ? 'live' : 'active') : 'ready';

  return {
    /** App-only tool: one JPEG frame. live_view=false → {state:'off'} without capturing anything. */
    async live_frame(args = {}) {
      if (!onlyKeys(args, ['maxWidth', 'quality'])) bad();
      const maxW = args.maxWidth ?? 960, quality = args.quality ?? 60;
      if (!int(maxW, 320, 1600) || !int(quality, 30, 90)) bad();
      if (!granted()) { setViewing(false, 'capability_off'); return {state: 'off', hint: 'Live View is not granted by the owner.'}; }
      if (!allowed()) { setViewing(false, 'no_active_session'); return {state: 'ready', hint: 'No task is running on the desktop: nothing to show. Frames resume automatically with the next GUI task.'}; }
      const f = await grab(maxW, quality);
      // 0.5.2 N-07: a capture that was in flight when Stop/finish ended the session is DROPPED, never delivered.
      if (!allowed()) { droppedAfterStop++; setViewing(false, 'ended_during_capture'); return {state: state(), hint: 'The session ended while a frame was being captured; it was discarded.'}; }
      lastServed = now(); lastFrameAt = lastServed; served++;
      setViewing(true, 'frame_request');
      const structured = {state: 'live', seq: f.seq, capturedAt: new Date(f.t).toISOString(), imageW: f.meta.imageW, imageH: f.meta.imageH,
        screenW: f.meta.screenW, screenH: f.meta.screenH, cursor: f.meta.cursorX >= 0 ? {x: f.meta.cursorX, y: f.meta.cursorY} : null,
        bytes: f.jpeg.length, ms: f.meta.ms};
      return {content: [{type: 'image', data: f.jpeg.toString('base64'), mimeType: 'image/jpeg'}, {type: 'text', text: JSON.stringify(structured)}], structured};
    },
    /** Raw frame for the gateway /live page proxy (same gating). */
    async frameBytes(maxW = 960, quality = 60) {
      if (!allowed()) { setViewing(false, 'no_active_session'); return null; }
      const f = await grab(maxW, quality);
      if (!allowed()) { droppedAfterStop++; setViewing(false, 'ended_during_capture'); return null; }
      lastServed = now(); lastFrameAt = lastServed; served++;
      setViewing(true, 'frame_request');
      return f;
    },
    live_control(args = {}) {
      if (!onlyKeys(args, ['action']) || !['status', 'stop'].includes(args.action)) bad();
      if (args.action === 'stop') {
        // 0.5.1: STOP ends the stream now (source side) and keeps it off for the rest of this session.
        // The persistent grant is not revoked — revoking it is set_capability live_view=false.
        if (session) { session.optOutLive(); if (session.status().kind === 'watch') session.end('live_stop').catch(() => {}); }
        else if (caps.live_view === true) store.set('live_view', false, 'live_control_stop');
        setViewing(false, 'stop');
        return {state: state(), stopped: true, streaming: false};
      }
      return {state: state(), granted: granted(), streaming: allowed(), viewing, framesServed: served};
    },
    watch_nexus(args = {}) {
      if (!onlyKeys(args, [])) bad();
      if (granted() && session) session.beginWatch(); // watch-only lease if no task runs; ends by idle TTL, frames do not renew it
      return {state: state(), granted: granted(), streaming: allowed(), session: session?.status() ?? null,
        note: granted() ? 'Frames are produced only while a session is active; the session ends with the task (finish_task), on Stop/cancel or after the idle lease.' :
          'Live View is not granted. The owner grants it once in the NEXUS profile (local, outside chat).'};
    },
    /** Called by the session end hook: stop serving immediately. */
    sessionEnded() { setViewing(false, 'session_end'); last = null; return {lastFrameAt: lastFrameAt || null, droppedAfterStop}; },
    status: () => ({state: state(), viewing, framesServed: served}),
    stop() { clearInterval(timer); },
  };
}

function defaultIndicator(on) {
  const msg = on ? '● LIVE VIEW: ON — your screen is being watched (STOP: say «выключи Live View» or close this window)' : '○ LIVE VIEW: off';
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
  try { process.title = on ? 'NEXUS Host — ● LIVE VIEW ON' : 'NEXUS Host'; } catch { /* not supported */ }
}
