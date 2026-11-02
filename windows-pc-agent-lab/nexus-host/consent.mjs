/**
 * NEXUS Host 0.5.0 — ownership of windows/tabs and owner consent for closing.
 *
 * Principle (owner, 01.11.2026): autonomy by default, consent for risky actions — no blanket ban.
 *  - Windows/tabs/processes created by NEXUS in this Host session are "owned": closing them is autonomous.
 *  - Closing anything else (user's or unknown window/tab/process) returns consent_required with a consentId
 *    and an exact target label. ChatGPT must ask the owner, then call confirm_action(consentId, decision, target).
 *    `target` must repeat the label, so the owner sees WHAT is closed in ChatGPT's "Always ask" prompt.
 *  - decision: close_discard (close, and if a save prompt appears «Don't save» is allowed for 60 s),
 *              close_save (close; saving is always allowed), cancel.
 *  - Consent is single-use, expires after 120 s, and the target is re-checked before execution.
 * Limitation (documented, not hidden): consent is mediated by ChatGPT; the Host cannot prove a human pressed
 * the button. The defence is the explicit target label in the Always-ask prompt plus the audit log.
 */
import crypto from 'node:crypto';

export const CLOSE_RE = /^(?:close|закрыть|close tab|закрыть вкладку|close window|закрыть окно|exit|выход|выйти|quit|завершить)(?:\b|\s|$)/i;
export const TAB_CLOSE_RE = /(?:close tab|закрыть вкладку)/i;
export const DISCARD_RE = /(?:не сохранять|don['’]?t save|do not save|discard|отменить изменения)/i;
const CLOSE_IDS = /^(?:close|closebutton|closetabbutton|close-button)$/i;
const TAB_KEYS = new Set(['ctrl+w', 'ctrl+f4']);
const WINDOW_KEYS = new Set(['alt+f4', 'ctrl+shift+w', 'shift+ctrl+w']);
const ACTIVATE_KEYS = new Set(['enter', 'space']);
const TTL_MS = 120_000;
const DISCARD_ARM_MS = 60_000;

const isClickable = t => ['Button', 'MenuItem', 'SplitButton', 'ListItem', 'Hyperlink'].includes(t);
// Windows TaskDialog (e.g. Notepad «Save changes?») exposes its buttons as Pane — verified on a real runner 01.11.2026.
// Discard detection therefore also covers Pane/Custom; close detection does not (a document is also a Pane whose
// Name is its text, so "Закрыть…" typed in a document must not count as a close button).
const DIALOG_BUTTON = t => ['Button', 'Pane', 'Custom'].includes(t);
// A document pane's Name is its whole text: only short, exact button-like names count as «Don't save».
const isDiscardName = n => typeof n === 'string' && n.length <= 30 && DISCARD_RE.test(n);

/** Classify a keyboard chord against the focused context. Returns null (not a close) or {kind, ...}. */
export function classifyKeys(keys, ctx) {
  const k = String(keys).toLowerCase();
  const el = ctx?.elem || {};
  if (WINDOW_KEYS.has(k)) return {kind: 'window', via: k};
  if (TAB_KEYS.has(k)) return (ctx?.window?.tabs?.length ? {kind: 'tab', via: k} : {kind: 'window', via: k});
  if (DIALOG_BUTTON(el.controlType) && isDiscardName(el.name) && ACTIVATE_KEYS.has(k)) return {kind: 'discard', via: k};
  if (el.controlType === 'MenuItem') {
    if (ACTIVATE_KEYS.has(k) && (CLOSE_RE.test(el.name) || TAB_CLOSE_RE.test(el.name))) return {kind: TAB_CLOSE_RE.test(el.name) ? 'tab' : 'window', via: 'menu:' + el.name};
    if (/^[a-z0-9]$/.test(k)) return {kind: 'window', via: 'menu-accelerator:' + k, uncertain: true};
  }
  return null;
}

/** Classify a mouse click target (the UIA element under the point). */
export function classifyClick(action, at) {
  if (!['click', 'double_click'].includes(action) || !at?.elem) return null;
  const {controlType, name, id} = at.elem;
  if (DIALOG_BUTTON(controlType) && isDiscardName(name)) return {kind: 'discard', via: 'click:' + name};
  if (!isClickable(controlType)) return null;
  if (CLOSE_RE.test(name) || TAB_CLOSE_RE.test(name) || CLOSE_IDS.test(id || '')) {
    const tabClose = TAB_CLOSE_RE.test(name) || (!!at.tab && controlType === 'Button');
    return {kind: tabClose ? 'tab' : 'window', via: 'click:' + (name || id)};
  }
  return null;
}

/**
 * `journal` (0.5.2 N-08, optional): {keyFor(what, target) → idempotency key or null (not external), alreadyDone(key) → {at, task}|null}.
 * A repeat of an external operation that already ran is shown to the owner as «ПОВТОР…» — never silently re-run.
 */
export function createConsent({audit = () => {}, now = () => Date.now(), journal = null} = {}) {
  // apps: process names that hold NEXUS-owned windows/tabs (where cleanup must look);
  // scratch: hwnd/rid of NEXUS scratch documents (identified by token) — on close their prompt is answered «Save»
  // (into the NEXUS scratch file), never «Don't save», so nothing typed into them is lost.
  const owned = {windows: new Set(), tabs: new Set(), pids: new Set(), apps: new Set(), scratch: new Set()};
  const pending = new Map();
  const armed = new Map(); // hwnd → expiry: «Don't save» allowed after a consented/owned close

  const label = (win, tab, kind) => {
    const app = win?.process || 'app';
    if (kind === 'tab' && tab) return `${app}: вкладка «${tab.name || '?'}»`;
    if (kind === 'process') return `${app} (pid ${win?.pid})`;
    return `${app}: окно «${win?.name || '?'}»`;
  };

  const tabsOf = win => (Array.isArray(win?.tabs) ? win.tabs : []).filter(t => t && typeof t.rid === 'string' && t.rid);
  function selectedTab(win) { return tabsOf(win).find(t => t.selected) || null; }

  /** Is the close of this target autonomous (everything in it was created by NEXUS)? */
  function isOwned(c, win, tab) {
    if (c.kind === 'tab') {
      const t = tab || selectedTab(win);
      return !!t && owned.tabs.has(t.rid);
    }
    if (c.kind === 'window') {
      if (!win || !owned.windows.has(String(win.hwnd))) return false;
      return tabsOf(win).every(t => owned.tabs.has(t.rid));
    }
    if (c.kind === 'discard') return (armed.get(String(win?.hwnd)) || 0) > now();
    return false;
  }

  return {
    owned,
    /**
     * Record windows/tabs that appeared between two snapshots (open_app, ctrl+n, ctrl+t…). FAIL-CLOSED (0.4.3):
     *  - before === null (snapshot failed) → nothing is owned;
     *  - cold start (no window of the app existed before) and the new window has tabs → Windows 11 Notepad may have
     *    RESTORED the owner's previous session into it → nothing is owned (closing needs consent);
     *  - a new window without tabs (classic Notepad, Calculator) → owned;
     *  - otherwise at most ONE new tab may be owned; several new tabs at once are ambiguous → nothing is owned.
     */
    recordCreated(before = [], after = [], source, {token = null} = {}) {
      const created = {windows: [], tabs: []};
      const refuse = reason => { created.ownership = 'none'; created.reason = reason;
        audit({event: 'nexus_created_refused', source, reason, windows: (after || []).length}); return created; };
      if (!Array.isArray(before) || !Array.isArray(after)) return refuse('snapshot_failed');
      const prevW = new Set(before.map(w => String(w.hwnd)));
      const prevT = new Set(before.flatMap(w => tabsOf(w).map(t => t.rid)));
      const newWins = after.filter(w => !prevW.has(String(w.hwnd)));
      const newTabs = after.flatMap(w => tabsOf(w).filter(t => !prevT.has(t.rid)).map(t => ({w, t})));
      // 0.5.0: a unique token (NEXUS scratch file name) identifies exactly what NEXUS opened, even on a cold start
      // with a restored session: only tabs/windows whose NAME contains the token are owned.
      if (token) {
        const has = x => typeof x?.name === 'string' && x.name.includes(token);
        for (const {w, t} of newTabs) if (has(t)) { owned.tabs.add(t.rid); owned.scratch.add(t.rid); if (w.process) owned.apps.add(w.process); created.tabs.push(t.name); }
        for (const w of newWins) {
          const tabs = tabsOf(w);
          if (tabs.length ? tabs.every(t => has(t) && !prevT.has(t.rid)) : has(w)) {
            owned.windows.add(String(w.hwnd)); owned.scratch.add(String(w.hwnd)); if (w.process) owned.apps.add(w.process);
            created.windows.push(w.name); if (w.pid) owned.pids.add(w.pid);
          }
        }
        created.ownership = created.windows.length || created.tabs.length ? 'token' : 'none';
        if (created.ownership === 'none') return refuse('token_not_found');
        audit({event: 'nexus_created', source, by: 'token', ...created});
        return created;
      }
      const cold = before.length === 0;
      if (cold && newWins.some(w => tabsOf(w).length)) return refuse('cold_start_session_restore_possible');
      if (newTabs.length > 1) return refuse('multiple_new_tabs_ambiguous');
      for (const w of newWins) {
        if (tabsOf(w).some(t => prevT.has(t.rid))) continue; // a window holding pre-existing tabs is not ours
        owned.windows.add(String(w.hwnd)); created.windows.push(w.name); if (w.pid) owned.pids.add(w.pid); if (w.process) owned.apps.add(w.process);
      }
      for (const {w, t} of newTabs) { owned.tabs.add(t.rid); if (w.process) owned.apps.add(w.process); created.tabs.push(t.name); }
      if (created.windows.length || created.tabs.length) audit({event: 'nexus_created', source, ...created});
      return created;
    },
    ownPid(pid) { owned.pids.add(pid); },
    forget(win) { if (win) { owned.windows.delete(String(win.hwnd)); owned.scratch.delete(String(win.hwnd)); for (const t of tabsOf(win)) { owned.tabs.delete(t.rid); owned.scratch.delete(t.rid); } } },
    forgetTab(rid) { owned.tabs.delete(rid); owned.scratch.delete(rid); },
    /** Drop owned windows/tabs that no longer exist (closed by the owner or by the app). `wins` = fresh snapshots. */
    prune(wins) {
      const hw = new Set(wins.map(w => String(w.hwnd))), rids = new Set(wins.flatMap(w => tabsOf(w).map(t => t.rid)));
      for (const h of [...owned.windows]) if (!hw.has(h)) { owned.windows.delete(h); owned.scratch.delete(h); }
      for (const r of [...owned.tabs]) if (!rids.has(r)) { owned.tabs.delete(r); owned.scratch.delete(r); }
    },
    isOwned,
    tabsOf,

    /**
     * Gate. Returns null when the action may run now; otherwise a consent_required result.
     * `replay` = {tool, args}; `win`/`tab` = current target; `c` = classification.
     */
    gate(c, win, tab, replay) {
      if (!c) return null;
      if (isOwned(c, win, tab)) {
        if (c.kind !== 'discard') armed.set(String(win?.hwnd), now() + DISCARD_ARM_MS);
        audit({event: 'close_autonomous', kind: c.kind, via: c.via, target: label(win, tab || selectedTab(win), c.kind)});
        return null;
      }
      const id = crypto.randomBytes(6).toString('hex');
      const t = tab || (c.kind === 'tab' ? selectedTab(win) : null);
      const target = c.kind === 'discard' ? `${win?.process || 'app'}: «Не сохранять» в окне «${win?.name || '?'}»` : label(win, t, c.kind);
      pending.set(id, {id, c, replay, hwnd: String(win?.hwnd ?? ''), rid: t?.rid || null, pid: win?.pid, target, expires: now() + TTL_MS});
      for (const [k, v] of pending) if (v.expires < now()) pending.delete(k);
      audit({event: 'consent_required', consentId: id, kind: c.kind, via: c.via, target});
      return {status: 'consent_required', consentId: id, kind: c.kind, target, uncertain: !!c.uncertain,
        options: c.kind === 'discard' ? ['close_discard', 'cancel'] : ['close_discard', 'close_save', 'cancel'],
        expiresInSec: TTL_MS / 1000,
        instruction: `This would close something NEXUS did not open (${target}). Ask the owner in chat. If the owner agrees, call confirm_action with consentId, the owner's decision, and target exactly "${target}". Never decide for the owner.`};
    },

    /**
     * 0.5.0: consent for a non-close risky action (granting app access, an irreversible browser click…).
     * `apply` runs only after confirm_action(decision 'allow'). Same single-use / TTL / exact-target rules.
     */
    requestGrant({what, target, apply, replay = null}) {
      if (typeof target !== 'string' || !target || typeof apply !== 'function') throw Error('invalid_args');
      const id = crypto.randomBytes(6).toString('hex');
      const idemKey = journal?.keyFor(what, target) || null;
      const prev = idemKey ? journal.alreadyDone(idemKey) : null;
      const base = target;
      if (prev) target = `ПОВТОР (уже выполнено ${String(prev.at).slice(0, 16).replace('T', ' ')} UTC): ${base}`;
      pending.set(id, {id, c: {kind: 'grant', what}, replay, apply, target, idemKey, baseTarget: base, repeat: !!prev, expires: now() + TTL_MS});
      for (const [k, v] of pending) if (v.expires < now()) pending.delete(k);
      audit({event: 'consent_required', consentId: id, kind: 'grant', what, target});
      return {status: 'consent_required', consentId: id, kind: 'grant', what, target, options: ['allow', 'cancel'], expiresInSec: TTL_MS / 1000,
        ...(prev ? {alreadyDone: {at: prev.at, task: prev.task}, warning: 'This external operation ALREADY RAN. First check its result with read tools; repeat only if the owner explicitly wants it done twice.'} : {}),
        instruction: `This needs the owner's permission (${target}). Ask the owner in chat. If the owner agrees, call confirm_action with consentId, decision "allow", and target exactly "${target}". Never decide for the owner.`};
    },

    /** Validate a confirm_action call; returns the pending record (consumed) or throws. */
    take(consentId, decision, target) {
      const p = pending.get(consentId);
      if (!p || p.expires < now()) { pending.delete(consentId); throw Error('consent_expired_or_unknown'); }
      if (target !== p.target) throw Error('consent_target_mismatch');
      const ok = p.c.kind === 'grant' ? ['allow', 'cancel'] : ['close_discard', 'close_save', 'cancel'];
      if (!ok.includes(decision)) throw Error('invalid_args');
      if (p.c.kind === 'discard' && decision === 'close_save') throw Error('invalid_args');
      pending.delete(consentId);
      audit({event: 'consent_decision', consentId, decision, target: p.target});
      return p;
    },
    armDiscard(hwnd) { armed.set(String(hwnd), now() + DISCARD_ARM_MS); },
    pendingCount: () => pending.size,
  };
}
