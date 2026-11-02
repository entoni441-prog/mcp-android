/**
 * NEXUS Host 0.5.2 — N-03 Owner Handoff + N-08 Task Continuity.
 *
 * Constraint of this stage: the tool catalog is NOT changed (the gateway Worker mirrors it byte for byte and is
 * production). So Handoff reuses existing tools:
 *   - a step NEXUS cannot/must not do returns {status:'owner_action_required', handoffId:'h-…', instruction…};
 *   - task_status {id:'h-…'} re-checks the result BY STATE (window present/gone…), long-polling up to ~20 s;
 *   - task_cancel {id:'h-…'} records the owner's refusal → the dependent step is skipped, never forced.
 * While a handoff waits: input (and, unless the handoff says otherwise, capture/UIA reading/Live View) is paused,
 * and the work session is held so the idle lease cannot end it and clean up NEXUS windows in the middle of the task.
 *
 * Task checkpoint (N-08): %USERPROFILE%\.nexus-host\tasks\<id>.json — stage, completed external operations with
 * idempotency keys, awaited owner action, NEXUS-created resources, checks, errors. Never typed text, file content or
 * secret values: targets pass redactSecrets and are cut to 200 chars; tool args are not stored.
 *
 * Idempotency: an operation with external consequences (the consented risky actions: paid/irreversible browser
 * steps, protected-file change/delete/copy, executor-file write, system-tool and security-page input, arbitrary IDE
 * command) gets key = sha256(what + target). If the same key completed within 24 h (in any task — including one
 * interrupted by Stop or a Host restart), the next request is not an ordinary consent: its target starts with
 * «ПОВТОР…», so the owner sees in the confirm prompt that it already ran. Without that exact consent nothing repeats.
 * Limitation: actions that need no consent (ordinary clicks/typing) are not journaled — they are not «external
 * consequences» under the owner policy, and a generic key for them would block legitimate repeated input.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {redactSecrets} from './policy.mjs';

export const HANDOFF_TTL_MS = 10 * 60_000;
export const POLL_MS = 20_000;
export const IDEM_WINDOW_MS = 24 * 3600_000;
const KEEP_FILES = 50;

/** Consents whose execution changes something outside NEXUS and must not silently run twice. */
const EXTERNAL_WHATS = new Set(['browser_financial', 'browser_irreversible', 'executor_file_write', 'system_tool', 'security_page', 'arbitrary_command']);
export function isExternal(what, target) {
  if (EXTERNAL_WHATS.has(what)) return true;
  if (what === 'protected_file' || what === 'protected_file_write') return /^(?:изменение|удаление|копирование)/i.test(String(target));
  return false;
}
export const idemKey = (what, target) => crypto.createHash('sha256').update(`${what}\n${target}`).digest('hex').slice(0, 32);
const clean = s => redactSecrets(String(s ?? '')).text.slice(0, 200);

/** Tools paused while an owner action is pending. Reads that show the screen pause only when capture is paused. */
export const INPUT_TOOLS = new Set(['mouse_action', 'keyboard_action', 'focus_window', 'open_app', 'close_window', 'process_action',
  'browser_open', 'browser_action', 'browser_tabs', 'run_task', 'write_text', 'make_dir', 'file_action', 'confirm_action']);
// Live View is paused through the session hold (frames simply stop), not by erroring the widget.
export const CAPTURE_TOOLS = new Set(['capture_screen', 'inspect_ui', 'window_info', 'browser_snapshot']);

/** Pure: evaluate a verifier against probe results. Returns 'done' | 'waiting' | 'unknown' | 'unverifiable'. */
export function evaluateVerify(verify, observed) {
  if (!verify || verify.kind === 'none') return 'unverifiable';
  if (observed === null || observed === undefined) return 'unknown';
  if (verify.kind === 'app_window') return Array.isArray(observed) && observed.length > 0 ? 'done' : Array.isArray(observed) ? 'waiting' : 'unknown';
  if (verify.kind === 'no_window') return Array.isArray(observed) && observed.length === 0 ? 'done' : Array.isArray(observed) ? 'waiting' : 'unknown';
  return 'unknown';
}

/** N-08: checkpoint files + idempotency journal. `dir` = <home>/tasks. */
export function createTaskLog({dir, now = () => Date.now(), audit = () => {}}) {
  fs.mkdirSync(dir, {recursive: true});
  const done = new Map(); // idemKey → {at, task, what}
  let cur = null;

  // Load the journal from recent checkpoints (survives Stop and Host restarts).
  for (const f of safeList()) {
    const t = readTask(f); if (!t) continue;
    for (const op of t.ops || []) if (op.ok && op.key && now() - Date.parse(op.at) < IDEM_WINDOW_MS) done.set(op.key, {at: op.at, task: t.id, what: op.what});
  }

  function safeList() { try { return fs.readdirSync(dir).filter(f => /^[a-z0-9-]+\.json$/.test(f)).map(f => path.join(dir, f)); } catch { return []; } }
  function readTask(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
  const iso = () => new Date(now()).toISOString();

  function save(t) {
    t.updatedAt = iso();
    const f = path.join(dir, t.id + '.json'), tmp = f + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(t, null, 1), {mode: 0o600}); fs.renameSync(tmp, f); }
    catch (e) { audit({event: 'task_checkpoint_write_failed', task: t.id, error: String(e?.code || e?.message).slice(0, 60)}); }
  }
  function prune() {
    const files = safeList().map(f => ({f, m: (() => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } })()})).sort((a, b) => b.m - a.m);
    for (const {f} of files.slice(KEEP_FILES)) { try { fs.rmSync(f); } catch {} }
  }

  const api = {
    /** The checkpoint of the current task; created on first use. `sessionId` ties it to the work session. */
    current(sessionId = null) {
      if (cur && (!sessionId || cur.session === sessionId || cur.session === null)) { if (sessionId && !cur.session) cur.session = sessionId; return cur; }
      cur = {id: 't-' + crypto.randomBytes(6).toString('hex'), version: 1, status: 'active', session: sessionId, startedAt: iso(), updatedAt: iso(),
        stage: null, ops: [], waiting: null, handoffs: [], created: [], checks: [], errors: []};
      save(cur); prune();
      return cur;
    },
    peek: () => cur,
    stage(tool, sessionId) { const t = api.current(sessionId); t.stage = {tool, at: iso()}; save(t); },
    created(items, source) { if (!items?.length) return; const t = api.current(); t.created.push({source, items: items.map(clean).slice(0, 10), at: iso()}); save(t); },
    error(tool, code) { const t = api.current(); t.errors.push({tool, code: String(code).slice(0, 80), at: iso()}); t.errors = t.errors.slice(-30); save(t); },
    check(entry) { const t = api.current(); t.checks.push({...entry, at: iso()}); t.checks = t.checks.slice(-30); save(t); },
    /** Idempotency lookup for an external operation. */
    alreadyDone(key) { const d = done.get(key); return d && now() - Date.parse(d.at) < IDEM_WINDOW_MS ? d : null; },
    recordOp({key, what, target, ok, repeat = false}) {
      const t = api.current();
      t.ops.push({key, what, target: clean(target), ok: !!ok, repeat, at: iso()});
      if (ok) done.set(key, {at: iso(), task: t.id, what});
      save(t);
    },
    waiting(h) { const t = api.current(); t.waiting = h ? {handoffId: h.id, reason: h.reason, what: h.what} : null; t.status = h ? 'waiting_owner' : 'active'; save(t); },
    handoff(rec) {
      const t = api.current(); const i = t.handoffs.findIndex(x => x.id === rec.id);
      const row = {id: rec.id, reason: rec.reason, what: clean(rec.what), state: rec.state, verify: rec.verify?.kind || 'none', resume: rec.resume?.tool || null, at: iso()};
      if (i < 0) t.handoffs.push(row); else t.handoffs[i] = row;
      save(t);
    },
    /** End of the work session: finished (finish_task) or interrupted (Stop, lease, Host stop) — resumable info stays. */
    close(reason) {
      if (!cur) return null;
      cur.status = reason === 'finish_task' ? 'finished' : 'interrupted'; cur.endReason = reason; cur.waiting = null;
      for (const h of cur.handoffs) if (h.state === 'waiting_owner') h.state = 'abandoned';
      save(cur); const id = cur.id; cur = null; return id;
    },
    summary(t = cur) {
      if (!t) return null;
      return {task: t.id, status: t.status, stage: t.stage, externalOpsDone: t.ops.filter(o => o.ok).map(o => ({what: o.what, target: o.target, at: o.at})),
        waitingFor: t.waiting, handoffs: t.handoffs.map(h => ({id: h.id, state: h.state})), errors: t.errors.slice(-5).map(e => `${e.tool}: ${e.code}`),
        file: `tasks/${t.id}.json`};
    },
    /** The last interrupted task (for resuming after Stop / Host restart). */
    lastInterrupted() {
      const files = safeList().map(f => readTask(f)).filter(t => t && t.status !== 'finished' && (!cur || t.id !== cur.id))
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      return files[0] ? api.summary(files[0]) : null;
    },
  };
  return api;
}

/**
 * N-03. `probe.apps(name)` → array of windows of that process, or null when unknown (same contract as gui.snapshotApp).
 * `session` (optional) provides hold/release so the lease cannot expire while the owner acts.
 */
export function createHandoffs({tasks, probe, session = null, audit = () => {}, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)),
  ttlMs = HANDOFF_TTL_MS, pollMs = POLL_MS, stepMs = 1000}) {
  const all = new Map();
  let active = null; // the handoff that pauses input/capture (one at a time)

  function expireIfNeeded(h) {
    if (h.state === 'waiting_owner' && now() > h.expiresAt) { finish(h, 'expired'); }
  }
  function finish(h, state, verified = null) {
    h.state = state; if (verified) h.verified = verified;
    if (active === h) { active = null; session?.release?.('handoff:' + h.id); tasks.waiting(null); }
    tasks.handoff(h);
    audit({event: 'handoff_' + state, handoffId: h.id, reason: h.reason});
  }
  async function observe(h) {
    const v = h.verify;
    if (!v || v.kind === 'none') return {state: 'unverifiable'};
    let obs = null; try { obs = await probe.apps(v.process); } catch { obs = null; }
    return {state: evaluateVerify(v, obs), observed: Array.isArray(obs) ? {windows: obs.length} : 'unknown'};
  }
  function view(h) {
    const base = {handoffId: h.id, state: h.state, reason: h.reason, what: h.what, where: h.where, check: h.check,
      paused: h.state === 'waiting_owner' ? h.pause : {input: false, capture: false},
      expiresInSec: h.state === 'waiting_owner' ? Math.max(0, Math.round((h.expiresAt - now()) / 1000)) : 0, checkpoint: tasks.summary()};
    if (h.state === 'done') return {...base, verified: h.verified, next: h.resume ? `Owner action verified by NEXUS. Continue from the checkpoint: call ${h.resume.tool} ${JSON.stringify(h.resume.args || {})} (it was NOT executed yet). Do not redo earlier steps.` : 'Owner action verified by NEXUS. Continue the task from the checkpoint; do not redo earlier steps.'};
    if (h.state === 'unverifiable') return {...base, next: 'NEXUS cannot verify this action by itself. Check the expected result with read tools (list_windows, inspect_ui, read_text, browser_snapshot) before continuing; never assume it from chat words alone.'};
    if (h.state === 'declined') return {...base, next: 'Owner declined. Skip the dependent step (do not try another way around it); continue with independent steps or call finish_task.'};
    if (h.state === 'expired' || h.state === 'abandoned') return {...base, next: 'Handoff is no longer active. The dependent step did not run. Ask the owner again only if still needed.'};
    return {...base, next: `Waiting for the owner. Tell the owner in chat exactly what to do (what/where above) — never ask for passwords or codes in chat. Then call task_status {"id":"${h.id}"} (it waits up to ${Math.round(pollMs / 1000)} s for the change). If the owner refuses: task_cancel {"id":"${h.id}"}.`};
  }

  return {
    /**
     * Create a handoff. spec: {reason, what, where, check, verify:{kind:'app_window'|'no_window'|'none', process}, pause:{input,capture},
     * resume:{tool,args}} — resume args are kept in memory only (never written to disk).
     */
    request(spec) {
      if (active) { expireIfNeeded(active); }
      if (active) return {status: 'owner_action_required', ...view(active), note: 'Another owner action is already pending; finish it first.'};
      const h = {id: 'h-' + crypto.randomBytes(5).toString('hex'), state: 'waiting_owner', reason: String(spec.reason || 'owner_action'),
        what: clean(spec.what), where: clean(spec.where || ''), check: clean(spec.check || 'NEXUS will check the state of Windows'),
        verify: spec.verify || {kind: 'none'}, pause: {input: spec.pause?.input !== false, capture: spec.pause?.capture !== false},
        resume: spec.resume || null, createdAt: now(), expiresAt: now() + ttlMs};
      all.set(h.id, h); active = h;
      for (const [k, v] of all) if (v !== active && now() - v.createdAt > 3 * ttlMs) all.delete(k);
      session?.hold?.('handoff:' + h.id, ttlMs, {pauseLive: h.pause.capture});
      tasks.handoff(h); tasks.waiting(h);
      audit({event: 'handoff_requested', handoffId: h.id, reason: h.reason, verify: h.verify.kind});
      return {status: 'owner_action_required', ...view(h)};
    },
    /** task_status {id:'h-…'}: long-poll the verifier. */
    async check(id) {
      const h = all.get(id); if (!h) throw Error('unknown_handoff_id');
      expireIfNeeded(h);
      if (h.state !== 'waiting_owner') return view(h);
      const until = now() + pollMs;
      for (;;) {
        const o = await observe(h);
        if (o.state === 'done') { finish(h, 'done', {by: h.verify.kind, process: h.verify.process, ...o.observed}); tasks.check({handoff: h.id, result: 'verified'}); return view(h); }
        if (o.state === 'unverifiable') { finish(h, 'unverifiable'); tasks.check({handoff: h.id, result: 'unverifiable'}); return view(h); }
        expireIfNeeded(h); if (h.state !== 'waiting_owner') return view(h);
        if (now() + stepMs > until) return {...view(h), lastObserved: o.observed ?? 'unknown'};
        await sleep(stepMs);
      }
    },
    /** task_cancel {id:'h-…'}: the owner refused. */
    decline(id) {
      const h = all.get(id); if (!h) throw Error('unknown_handoff_id');
      if (h.state === 'waiting_owner') { finish(h, 'declined'); tasks.check({handoff: h.id, result: 'declined'}); }
      return view(h);
    },
    /** Called before every tool call. Throws while the active handoff pauses this tool. */
    guard(tool) {
      if (!active) return;
      expireIfNeeded(active); if (!active) return;
      if ((active.pause.input && INPUT_TOOLS.has(tool)) || (active.pause.capture && CAPTURE_TOOLS.has(tool))) {
        const e = Error('owner_handoff_active'); e.detail = active.id; throw e;
      }
    },
    capturePaused() { if (active) expireIfNeeded(active); return !!active && active.pause.capture; },
    pending: () => (active ? view(active) : null),
    /** Session ended (Stop/finish_task/lease): the pending handoff cannot continue in a new session. */
    abandon() { if (active) finish(active, 'abandoned'); },
  };
}
