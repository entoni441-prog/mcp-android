/**
 * NEXUS Host 0.5.2 — sequential window lifecycle (owner requirement 02.11, revision 2):
 *   open → act → verify → close, one window at a time.
 *
 * The Host tracks, per NEXUS window (hwnd), whether NEXUS gave it input and whether the result was observed after
 * the last input (inspect_ui / window_info / capture_screen). Rules (enforced by apps.open_app and gui.close_window):
 *  - open_app is refused while a NEXUS window has input that was not checked   → nexus_window_unverified;
 *  - close_window of a NEXUS window with unchecked input is refused             → nexus_verify_before_close.
 * A NEXUS window that never received input (opened only to read from) may stay open next to the working one; the
 * NEXT-1 (owner Р2): checked windows may stay open while the task needs them; the count is a regulation (caps.windowBudget,
 * more needs a stated reason) with a protective ceiling (MAX_WINDOWS_HARD), see apps.open_app.
 * Session-end cleanup is not blocked by these rules; it reports windows whose last input was never checked.
 */
export function createLifecycle({now = () => Date.now()} = {}) {
  const ent = new Map(); // hwnd → {hwnd, pid, process, inputs, lastInputAt, verifiedAt} (orders from `seq`)
  let current = null;    // hwnd of the window NEXUS last gave input to
  let seq = 0;           // event order (timestamps can tie within one millisecond)

  function forget(hwnd) { const k = String(hwnd); ent.delete(k); if (current === k) current = null; }

  return {
    /** NEXUS sent input into this top-level window. */
    input({hwnd, pid = null, process = null} = {}) {
      if (hwnd === undefined || hwnd === null) return;
      const k = String(hwnd);
      const e = ent.get(k) || {hwnd: k, pid, process, inputs: 0, lastInputAt: 0, verifiedAt: 0};
      e.inputs++; e.lastInputAt = ++seq; e.at = now(); if (pid) e.pid = pid; if (process) e.process = process;
      ent.set(k, e); current = k;
    },
    /**
     * A read tool observed the desktop. With a pid, the NEXUS windows of that process are checked; without one
     * (capture_screen, inspect_ui of the focused window), the window NEXUS last worked in.
     */
    observed({pid = null} = {}) {
      const t = ++seq, hit = [];
      for (const e of ent.values()) {
        const match = pid ? e.pid === pid : e.hwnd === current;
        if (match && e.lastInputAt && e.lastInputAt <= t) { e.verifiedAt = t; hit.push(e.hwnd); }
      }
      return hit;
    },
    forget,
    /**
     * Classify the NEXUS windows that are present now (`present` = [{app, hwnd, tab?}] from the owned-window snapshot).
     * Entries for windows that are gone are dropped (only when every snapshot succeeded).
     */
    classify(present = [], {prune = true} = {}) {
      const here = new Map();
      for (const p of present) if (!here.has(String(p.hwnd))) here.set(String(p.hwnd), p);
      if (prune) for (const k of [...ent.keys()]) if (!here.has(k)) forget(k); // a failed snapshot never drops state
      const out = {unverified: [], done: [], untouched: []};
      for (const [k, p] of here) {
        const e = ent.get(k);
        const item = {app: p.app, hwnd: k, ...(e?.pid ? {pid: e.pid} : {})};
        if (!e || !e.inputs) out.untouched.push(item);
        else if (e.verifiedAt < e.lastInputAt) out.unverified.push(item);
        else out.done.push(item);
      }
      return out;
    },
    /** Unchecked input in this window? (close_window gate) */
    unverified(hwnd) { const e = ent.get(String(hwnd)); return !!e && e.inputs > 0 && e.verifiedAt < e.lastInputAt; },
    status() { return [...ent.values()].map(e => ({app: e.process, hwnd: e.hwnd, inputs: e.inputs, checked: e.verifiedAt >= e.lastInputAt})); },
  };
}
