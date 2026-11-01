/**
 * NEXUS Host 0.5.0 — Live View source (pull model).
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

export function createLive({caps, store, capture, audit = () => {}, now = () => Date.now(), indicator = defaultIndicator, setIntervalFn = setInterval}) {
  let seq = 0, last = null, inflight = null, viewing = false, lastServed = 0, served = 0, since = 0;
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

  const state = () => caps.live_view === true ? (viewing ? 'live' : 'ready') : 'off';

  return {
    /** App-only tool: one JPEG frame. live_view=false → {state:'off'} without capturing anything. */
    async live_frame(args = {}) {
      if (!onlyKeys(args, ['maxWidth', 'quality'])) bad();
      const maxW = args.maxWidth ?? 960, quality = args.quality ?? 60;
      if (!int(maxW, 320, 1600) || !int(quality, 30, 90)) bad();
      if (caps.live_view !== true) { setViewing(false, 'capability_off'); return {state: 'off', hint: 'Live View is off. The owner can say in chat: «включи Live View».'}; }
      const f = await grab(maxW, quality);
      lastServed = now(); served++;
      setViewing(true, 'frame_request');
      const structured = {state: 'live', seq: f.seq, capturedAt: new Date(f.t).toISOString(), imageW: f.meta.imageW, imageH: f.meta.imageH,
        screenW: f.meta.screenW, screenH: f.meta.screenH, cursor: f.meta.cursorX >= 0 ? {x: f.meta.cursorX, y: f.meta.cursorY} : null,
        bytes: f.jpeg.length, ms: f.meta.ms};
      return {content: [{type: 'image', data: f.jpeg.toString('base64'), mimeType: 'image/jpeg'}, {type: 'text', text: JSON.stringify(structured)}], structured};
    },
    /** Raw frame for the gateway /live page proxy (same gating). */
    async frameBytes(maxW = 960, quality = 60) {
      if (caps.live_view !== true) return null;
      const f = await grab(maxW, quality);
      lastServed = now(); served++;
      setViewing(true, 'frame_request');
      return f;
    },
    live_control(args = {}) {
      if (!onlyKeys(args, ['action']) || !['status', 'stop'].includes(args.action)) bad();
      if (args.action === 'stop') {
        const r = caps.live_view === true ? store.set('live_view', false, 'live_control_stop') : {changed: false};
        setViewing(false, 'stop');
        return {state: 'off', stopped: true, changed: !!r.changed};
      }
      return {state: state(), live_view: caps.live_view === true, viewing, framesServed: served};
    },
    watch_nexus(args = {}) {
      if (!onlyKeys(args, [])) bad();
      return {state: state(), live_view: caps.live_view === true, gui_input: caps.gui_input === true,
        note: caps.live_view === true ? 'Live View widget: frames are fetched by the widget only while it is visible.' :
          'Live View is off. Ask the owner; turn on only after an explicit request: set_capability live_view=true.'};
    },
    status: () => ({state: state(), viewing, framesServed: served}),
    stop() { clearInterval(timer); },
  };
}

function defaultIndicator(on) {
  const msg = on ? '● LIVE VIEW: ON — your screen is being watched (STOP: say «выключи Live View» or close this window)' : '○ LIVE VIEW: off';
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
  try { process.title = on ? 'NEXUS Host — ● LIVE VIEW ON' : 'NEXUS Host'; } catch { /* not supported */ }
}
