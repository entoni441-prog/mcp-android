/**
 * NEXUS Host 0.4.0 — local browser agent (own TinyFish-like core), zero npm dependencies.
 * Microsoft Edge (signed, preinstalled) in a SEPARATE profile %USERPROFILE%\.nexus-host\edge-profile,
 * driven over the Chrome DevTools Protocol with Node's built-in WebSocket (Node ≥ 22).
 * The owner's normal Edge/Chrome profile, cookies and passwords are never touched.
 *
 * Policy (two layers):
 *  1. urlAllowed — fast refusal of non-http(s) URLs and literal local/private hosts in tool arguments;
 *  2. egress-proxy.mjs — NETWORK LEVEL: all browser traffic (navigations, every redirect hop, subresources,
 *     fetch/XHR/WebSocket) is forced through a local proxy that resolves DNS once and refuses any name that
 *     resolves to a non-public address, then connects to that checked IP (DNS rebinding cannot swap it).
 *     QUIC disabled, WebRTC limited to proxied traffic, loopback NOT bypassed.
 * Downloads denied; typing into password fields refused; snapshot never returns field values.
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn, spawnSync} from 'node:child_process';
import os from 'node:os';
import {requireCap} from './capabilities.mjs';
import {createEgressProxy, isPublicIp} from './egress-proxy.mjs';

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (a, allowed) => isObj(a) && Object.keys(a).every(k => allowed.includes(k));
const bad = () => { throw Error('invalid_args'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function urlAllowed(raw, {allowPrivate = false} = {}) {
  let u; try { u = new URL(raw); } catch { return false; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return false;
  if (allowPrivate) return true;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') && !net.isIP(h)) return false;
  if (net.isIP(h) && !isPublicIp(h)) return false;
  // Decimal/hex/octal IPv4 spellings (http://2130706433/, http://0x7f.1/) are normalised by WHATWG URL to dotted form above.
  return true;
}

export function findEdge(caps, env = process.env, exists = fs.existsSync) {
  if (caps?.edgePath) return exists(caps.edgePath) ? caps.edgePath : null;
  const c = [env['ProgramFiles(x86)'], env.ProgramFiles].filter(Boolean).map(p => path.win32.join(p, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  return c.find(p => exists(p)) || null;
}

class Cdp {
  static async connect(url) {
    if (typeof WebSocket !== 'function') throw Error('websocket_unavailable_node22_required');
    const c = new Cdp(); c.ws = new WebSocket(url); c.seq = 0; c.pending = new Map(); c.listeners = new Map();
    await new Promise((res, rej) => { c.ws.onopen = res; c.ws.onerror = () => rej(Error('cdp_connect_failed')); });
    c.ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.method) { for (const f of c.listeners.get(m.method) || []) { try { f(m.params || {}); } catch { /* listener */ } } return; } const p = m.id && c.pending.get(m.id); if (p) { c.pending.delete(m.id); m.error ? p.rej(Error('cdp_error')) : p.res(m.result); } };
    c.ws.onclose = () => { for (const p of c.pending.values()) p.rej(Error('browser_closed')); c.pending.clear(); c.closed = true; };
    return c;
  }
  send(method, params = {}, timeoutMs = 20_000) {
    if (this.closed) return Promise.reject(Error('browser_closed'));
    const id = ++this.seq;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(Error('cdp_timeout')); }, timeoutMs);
      this.pending.set(id, {res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); }});
      this.ws.send(JSON.stringify({id, method, params}));
    });
  }
  on(method, f) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(f); }
  close() { try { this.ws.close(); } catch { /* closed */ } }
}

const SNAPSHOT_JS = `(() => {
  const max = 150; let n = 0; const items = [];
  document.querySelectorAll('[data-nexus-ref]').forEach(e => e.removeAttribute('data-nexus-ref'));
  const sel = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=tab],[role=menuitem],[role=option],[contenteditable=""],[contenteditable=true]';
  const clip = s => String(s || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  for (const el of document.querySelectorAll(sel)) {
    if (n >= max) break;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    const ref = 'e' + (++n); el.setAttribute('data-nexus-ref', ref);
    const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
    const isField = tag === 'input' || tag === 'textarea' || tag === 'select';
    const name = clip(el.getAttribute('aria-label') || (isField ? (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute('placeholder') || el.getAttribute('name') : el.innerText) || el.getAttribute('title'));
    const it = {ref, tag, name};
    if (type) it.type = type; if (el.getAttribute('role')) it.role = el.getAttribute('role');
    if (tag === 'a') it.href = String(el.href).slice(0, 200);
    if (el.disabled) it.disabled = true;
    if (type === 'checkbox' || type === 'radio') it.checked = !!el.checked;
    items.push(it);
  }
  return {url: location.href, title: document.title.slice(0, 200), text: (document.body ? document.body.innerText : '').slice(0, 6000), elements: items};
})()`;

const KEYS = {Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, PageDown: 34, PageUp: 33, Home: 36, End: 35, Space: 32};

/** allowPrivate and proxyOptions are TEST-ONLY injections; production callers (server.mjs) never pass them. */
// ── 0.5.1 D2/D3: risk boundary for browser clicks / Enter. ──
// Autonomous: search, compare, add to cart, go to cart/checkout, fill ordinary fields, move between checkout steps.
// Owner consent: the step that CREATES a paid obligation (buy/pay/place order/pay later/subscribe/trial/booking/transfer)
// — decided by label AND by context: on a checkout/payment page any form-submitting control whose label is not a
// known navigation step needs consent, because its result (order created?) cannot be known in advance.
// Outgoing/destructive actions on the owner's behalf (send/post/publish/delete/register) also need consent (D3).
export const COMMIT_RE = /(\bbuy\b|\bpurchase|\bpay\b|\bpay\s*(now|later|in\b)|\bpaypal\b|\bpayment|place\s+(the\s+|your\s+|my\s+)?order|\border\s+now\b|submit\s+order|complete\s+(order|purchase|checkout|payment|booking)|confirm\s+(and\s+pay|order|purchase|payment|booking|subscription)|^\s*order\s*$|subscribe|start\s+(my\s+|free\s+|your\s+)?(trial|subscription|membership)|\bbook\s+now\b|\breserve\b|\bdonate\b|\btransfer\b|send\s+money|купить|оплат|заказать|разместить\s+заказ|оформить\s+заказ|подтвердить\s+(заказ|оплату|покупку|бронирование|перевод)|забронировать|подписаться|оформить\s+подписку|перевести|перевод|пожертвовать|\bacquista|\bcompra\b|\bpaga\b|\bpagamento|\bordina\b|invia\s+(l'|l’)?ordine|conferma\s+(e\s+paga|(l'|l’)?ordine|(l'|l’)?acquisto|(il\s+)?pagamento)|abbonati|abbonamento|\bprenota)/i;
export const SAFE_STEP_RE = /^\s*((proceed|continue|go)\s+to\s+(checkout|cart|basket|bag|shipping|delivery|address)|checkout|view\s+(cart|basket|bag)|(add|move)\s+to\s+(cart|basket|bag)|apply(\s+(coupon|promo|code|discount))?|back|edit|change|cancel|search|в\s+корзину|добавить\s+в\s+корзину|перейти\s+в\s+корзину|корзина|(перейти\s+)?к\s+оформлению(\s+заказа)?|применить(\s+промокод|\s+купон)?|назад|изменить|отмена|найти|поиск|procedi\s+(all'|all’)ordine|procedi\s+al\s+checkout|vai\s+(alla\s+cassa|al\s+carrello)|aggiungi\s+al\s+carrello|indietro|modifica|annulla|cerca)(?![\p{L}\p{N}])/iu;
export const CART_EDIT_RE = /(remove|delete|удалить|убрать|rimuovi|elimina).{0,25}(from\s+(cart|basket|bag)|из\s+корзины|dal\s+carrello)/i;
export const OUTGOING_RE = /(\bsend\b|\bpost\b|\bpublish|\bdelete\b|remove\s+account|\bsign\s*up\b|\bregister\b|\bsubmit\b|отправ|опубликов|удали|зарегистр|разместить|\binvia\b|\bpubblica|\belimina\b|registrati|iscriviti)/i;
const CHECKOUT_URL_RE = /(checkout|payment|\/pay\b|billing|\/order|cassa|pagamento|oplata|oformlenie|\/buy\b)/i;
const PAY_FRAME_RE = /(stripe\.com|braintreegateway|adyen|paypal\.com|checkout\.com|klarna|yookassa|cloudpayments|nexi|satispay|worldpay|squareup)/i;
const SECRET_FIELD_RE = /(card.?(number|num|no)|ccnum|cc-?number|cvv|cvc|csc|security.?code|iban|\botp\b|2fa|one.?time|verification.?code|passcode|\bpin\b)/i;

/**
 * Pure decision from page facts. Returns null (autonomous) or {what, reason}.
 * 0.5.2 B-01: `opensDialog` — the control only opens a dialog ON THE SAME PAGE (Bootstrap data-(bs-)toggle=modal with an
 * existing modal target, or aria-haspopup=dialog / aria-controls → [role=dialog]|<dialog>), is not a form submit and
 * has no inline onclick. Opening a form is not an obligation (Demoblaze «Place Order» → order form); the control that
 * then CREATES the order («Purchase») is classified on its own. Residual risk: a page script attached with
 * addEventListener to such a control cannot be seen — documented, as for every label-based decision.
 */
export function classifyBrowserRisk({label = '', submit = false, checkout = null, opensDialog = null} = {}) {
  const l = String(label || '').replace(/\s+/g, ' ').trim();
  if (CART_EDIT_RE.test(l)) return null;
  if (opensDialog && !submit) return null;
  if (COMMIT_RE.test(l)) return {what: 'browser_financial', reason: 'commitment_label'};
  if (checkout && submit && !SAFE_STEP_RE.test(l)) return {what: 'browser_financial', reason: 'checkout_submit_' + checkout};
  if (OUTGOING_RE.test(l)) return {what: 'browser_irreversible', reason: 'outgoing_or_destructive'};
  return null;
}

// Page facts for classifyBrowserRisk: label of the target (or of the form's default submit for Enter), whether it
// submits a form, and whether the page is a checkout/payment page. No values of fields are read.
export const FACTS_JS = (ref, key) => `(() => {
  const txt = e => String(e && (e.getAttribute('aria-label') || (e.tagName === 'INPUT' ? e.value : e.innerText) || e.getAttribute('title')) || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  const U = new RegExp(${JSON.stringify(CHECKOUT_URL_RE.source)}, 'i'), F = new RegExp(${JSON.stringify(PAY_FRAME_RE.source)}, 'i'), S = new RegExp(${JSON.stringify(SECRET_FIELD_RE.source)}, 'i');
  const checkout = U.test(location.pathname + location.search) ? 'url'
    : [...document.querySelectorAll('input')].some(i => /^cc-/.test(i.autocomplete || '') || S.test((i.name || '') + ' ' + (i.id || ''))) ? 'card_fields'
    : [...document.querySelectorAll('iframe[src]')].some(f => F.test(f.src)) ? 'payment_frame' : null;
  const isSubmit = e => { if (!e) return false; const t = (e.getAttribute('type') || '').toLowerCase();
    if (e.tagName === 'INPUT') return t === 'submit' || t === 'image'; if (e.tagName === 'BUTTON') return (t === '' || t === 'submit') && !!e.form; return false; };
  ${ref ? `let e = document.querySelector('[data-nexus-ref="' + ${JSON.stringify(ref || '')} + '"]'); if (!e) return null;
    const c = e.closest('button,a,input,[role=button]') || e;
    const byId = v => { try { return v ? document.querySelector(v.startsWith('#') ? v : '#' + CSS.escape(v)) : null; } catch { return null; } };
    const isDlg = d => !!d && (d.tagName === 'DIALOG' || d.getAttribute('role') === 'dialog' || d.getAttribute('role') === 'alertdialog' || (d.classList && d.classList.contains('modal')));
    const href = c.tagName === 'A' ? (c.getAttribute('href') || '') : '';
    const navigates = c.tagName === 'A' && href && !href.startsWith('#') && !/^javascript:\\s*(void\\(0\\);?)?$/i.test(href);
    let opensDialog = null;
    if (!isSubmit(c) && !c.hasAttribute('onclick') && !navigates) {
      const tg = c.getAttribute('data-toggle') || c.getAttribute('data-bs-toggle');
      const ctl = c.getAttribute('aria-controls');
      if (tg === 'modal' && isDlg(byId(c.getAttribute('data-target') || c.getAttribute('data-bs-target') || (href.startsWith('#') ? href : '')))) opensDialog = 'modal';
      else if (ctl && isDlg(byId(ctl)) && (c.getAttribute('aria-haspopup') === 'dialog' || c.getAttribute('aria-haspopup') === 'true' || c.hasAttribute('aria-expanded'))) opensDialog = 'aria_dialog';
    }
    return {label: txt(c), submit: isSubmit(c), checkout, opensDialog};` :
    `if (${JSON.stringify(key || '')} !== 'Enter') return null; const a = document.activeElement; const f = a && a.form;
     if (a && a.tagName === 'BUTTON') return {label: txt(a), submit: isSubmit(a), checkout};
     if (!f) return checkout ? {label: '', submit: true, checkout} : null;
     const b = f.querySelector('button:not([type]),button[type=submit],input[type=submit],input[type=image]'); return {label: txt(b), submit: true, checkout};`}
})()`;
export const SECRET_FIELD_SOURCE = SECRET_FIELD_RE.source;

/**
 * 0.5.1: PIDs of browser processes started with OUR profile (--user-data-dir=<profile>), incl. leftovers of a crashed
 * Host. The owner's Edge never uses this directory, so it can never match. Windows: CIM query in PowerShell (profile
 * path passed via env, never interpolated); Linux: /proc/<pid>/cmdline.
 */
export function profilePids(profile, {platform = process.platform, systemRoot = process.env.SystemRoot, run = spawnSync} = {}) {
  // Exact directory only: --user-data-dir=<p> or --user-data-dir="<p>" followed by a quote, space or end (never <p>2).
  const matches = cmd => {
    const c = String(cmd).toLowerCase(), p = profile.toLowerCase();
    for (const f of ['--user-data-dir=' + p, '--user-data-dir="' + p]) {
      let i = c.indexOf(f);
      while (i >= 0) { const nx = c[i + f.length]; if (nx === undefined || nx === '"' || /\s/.test(nx)) return true; i = c.indexOf(f, i + 1); }
    }
    return false;
  };
  if (platform === 'win32') {
    if (typeof systemRoot !== 'string' || !/^[a-zA-Z]:\\/.test(systemRoot)) return [];
    const ps = "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; cmd = $_.CommandLine } } | ConvertTo-Json -Compress";
    const r = run(path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], {encoding: 'utf8', windowsHide: true, timeout: 20_000});
    if (r.status !== 0 || !r.stdout?.trim()) return [];
    let rows; try { rows = JSON.parse(r.stdout); } catch { return []; }
    return (Array.isArray(rows) ? rows : [rows]).filter(x => x && x.cmd && matches(x.cmd)).map(x => Number(x.pid)).filter(Number.isInteger);
  }
  if (platform === 'linux') {
    const out = [];
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d) || Number(d) === process.pid) continue;
      let cmd; try { cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0').join(' '); } catch { continue; }
      if (matches(cmd)) out.push(Number(d));
    }
    return out;
  }
  return [];
}

function killPids(pids, {platform = process.platform, systemRoot = process.env.SystemRoot, run = spawnSync, tree = false} = {}) {
  let n = 0;
  for (const pid of pids) {
    if (platform === 'win32') {
      if (typeof systemRoot !== 'string') continue;
      const r = run(path.win32.join(systemRoot, 'System32', 'taskkill.exe'), ['/pid', String(pid), ...(tree ? ['/t'] : []), '/f'], {windowsHide: true, timeout: 15_000});
      if (r.status === 0) n++;
    } else { try { process.kill(pid, 'SIGKILL'); n++; } catch { /* gone */ } }
  }
  return n;
}

export function createBrowser({caps, home, consent = null, platform = process.platform, browserPath, headless = false, allowPrivate = false, proxyOptions = {}, spawnFn = spawn, onOwnedPid = () => {}, listPids = null, kill = null}) {
  const profile = path.join(home, 'edge-profile');
  const findPids = listPids || (() => profilePids(profile, {platform}));
  const killFn = kill || ((pids, o) => killPids(pids, {platform, ...o}));
  let proc = null, page = null, browserWs = null, proxy = null, port = null, currentTarget = null;
  // 0.5.1: JavaScript dialogs block the page (every CDP call on it hangs → cdp_timeout). alert/beforeunload on the NEXUS
  // browser are accepted automatically and reported; confirm/prompt wait for a decision (action 'dialog').
  let pendingDialog = null, dialogWaiters = [], seenDialogs = [];
  const clip = (x, n) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  function onDialog(cdp, d) {
    const info = {type: d.type, message: clip(d.message, 300)};
    if (d.type === 'alert' || d.type === 'beforeunload') {
      seenDialogs.push({...info, handled: 'accepted_automatically'});
      cdp.send('Page.handleJavaScriptDialog', {accept: true}).catch(() => {});
      return;
    }
    pendingDialog = {...info, ...(d.type === 'prompt' ? {defaultPrompt: clip(d.defaultPrompt, 200)} : {}), cdp};
    for (const w of dialogWaiters.splice(0)) w();
  }
  const dialogOpened = () => new Promise(r => { if (pendingDialog) r(); else dialogWaiters.push(r); });
  const dialogStatus = () => ({status: 'dialog_open', dialog: {type: pendingDialog.type, message: pendingDialog.message, ...(pendingDialog.defaultPrompt !== undefined ? {defaultPrompt: pendingDialog.defaultPrompt} : {})},
    instruction: 'The page shows a dialog and is blocked until it is answered. Call browser_action {action:"dialog", value:"accept"|"dismiss"} (text = answer for a prompt). Accepting a dialog that confirms a purchase/payment/sending needs the owner (consent_required).'});
  /** Run a page command; if a confirm/prompt dialog opens meanwhile, stop waiting (the command resumes after the answer). */
  async function untilDialog(promise) {
    const DIALOG = Symbol('dialog');
    promise.catch(() => {});
    const r = await Promise.race([promise, dialogOpened().then(() => DIALOG)]);
    if (r === DIALOG) throw Object.assign(Error('dialog_open'), {dialog: true});
    return r;
  }
  let sweptOnce = false;

  async function ensure() {
    if (page && !page.closed) return page;
    const exe = browserPath || (platform === 'win32' ? findEdge(caps) : null);
    if (!exe) throw Error('edge_not_found');
    fs.mkdirSync(profile, {recursive: true});
    const portFile = path.join(profile, 'DevToolsActivePort');
    fs.rmSync(portFile, {force: true});
    if (!proxy) { proxy = createEgressProxy({allowPrivate, ...proxyOptions}); proxy.port = await proxy.listen(); }
    const args = [`--user-data-dir=${profile}`, `--proxy-server=http://127.0.0.1:${proxy.port}`, '--proxy-bypass-list=<-loopback>',
      '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--dns-prefetch-disable', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--no-first-run',
      '--no-default-browser-check', '--disable-sync', '--disable-features=msEdgeSyncFeature', 'about:blank'];
    if (headless) args.unshift('--headless=new', '--no-sandbox');
    proc = spawnFn(exe, args, {stdio: 'ignore', windowsHide: false, detached: false});
    proc.once('exit', () => { proc = null; page?.close(); page = null; });
    if (proc.pid) onOwnedPid(proc.pid);
    let lines = null;
    for (let i = 0; i < 100 && !lines; i++) { await sleep(150); try { const t = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/); if (t.length >= 2) lines = t; } catch { /* not yet */ } }
    if (!lines) throw Error('browser_start_timeout');
    port = Number(lines[0]);
    browserWs = await Cdp.connect(`ws://127.0.0.1:${port}${lines[1]}`);
    await browserWs.send('Browser.setDownloadBehavior', {behavior: 'deny'}).catch(() => {});
    const target = (await pages()).find(Boolean);
    if (!target) throw Error('no_page_target');
    return attach(target);
  }
  async function pages() {
    if (!port) return [];
    let list;
    // NEXT NX-052-29: after the last tab closed, Edge exits and the DevTools port is gone → «no browser», not internal_error.
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(3000)})).json(); }
    catch { gone(); return []; }
    return Array.isArray(list) ? list.filter(t => t.type === 'page') : [];
  }
  function gone() { try { page?.close(); } catch {} try { browserWs?.close(); } catch {} page = null; browserWs = null; port = null; currentTarget = null; }
  async function attach(target) {
    const next = await Cdp.connect(target.webSocketDebuggerUrl);
    next.on('Page.javascriptDialogOpening', d => onDialog(next, d));
    next.on('Page.javascriptDialogClosed', () => { if (pendingDialog?.cdp === next) pendingDialog = null; });
    await next.send('Page.enable'); await next.send('Runtime.enable');
    if (page && page !== next) page.close();
    page = next; currentTarget = target.id;
    return page;
  }
  const shortId = id => String(id).slice(0, 8).toLowerCase();
  const evaluate = async (expr) => {
    if (pendingDialog) throw Object.assign(Error('dialog_open'), {dialog: true});
    const r = await untilDialog((await ensure()).send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true}));
    if (r.exceptionDetails) throw Error('page_script_failed');
    return r.result?.value;
  };
  async function waitLoad() {
    for (let i = 0; i < 60 && !pendingDialog; i++) { try { if (await evaluate('document.readyState') === 'complete') return; } catch { /* navigating */ } await sleep(250); }
  }
  async function guardUrl() {
    const url = await evaluate('location.href');
    const reset = async code => { await page.send('Page.navigate', {url: 'about:blank'}); await waitLoad(); throw Error(code); };
    if (/^chrome-error:|^edge-error:/.test(url)) await reset('navigation_blocked');
    if (await evaluate("(document.body ? document.body.innerText : '').startsWith('nexus_egress_denied')")) await reset('egress_denied_private_destination');
    if (url !== 'about:blank' && !urlAllowed(url, {allowPrivate})) { await page.send('Page.navigate', {url: 'about:blank'}); throw Error('url_not_allowed_after_redirect'); }
    return url;
  }
  const refExpr = ref => { if (!/^e\d{1,4}$/.test(ref)) bad(); return `document.querySelector('[data-nexus-ref="${ref}"]')`; };

  return {
    async browser_open(args) {
      requireCap(caps, 'browser');
      if (!onlyKeys(args, ['url']) || typeof args.url !== 'string' || args.url.length > 2000) bad();
      if (!urlAllowed(args.url, {allowPrivate})) throw Error('url_not_allowed');
      const p = await ensure();
      await p.send('Page.navigate', {url: args.url}); await waitLoad();
      const url = await guardUrl();
      return {url, title: await evaluate('document.title'), profile: 'nexus-separate'};
    },
    async browser_snapshot(args) {
      requireCap(caps, 'browser');
      if (!onlyKeys(args, ['screenshot'])) bad();
      if (args.screenshot !== undefined && typeof args.screenshot !== 'boolean') bad();
      if (!page) throw Error('browser_not_open');
      if (pendingDialog) return dialogStatus();
      await guardUrl();
      const snap = await evaluate(SNAPSHOT_JS);
      if (!args.screenshot) return snap;
      const shot = await page.send('Page.captureScreenshot', {format: 'jpeg', quality: 60});
      return {content: [{type: 'image', data: shot.data, mimeType: 'image/jpeg'}, {type: 'text', text: JSON.stringify(snap)}], structured: snap};
    },
    async browser_action(args, opts = {}) {
      requireCap(caps, 'browser');
      if (!onlyKeys(args, ['action', 'ref', 'text', 'key', 'url', 'clear', 'amount', 'value', 'timeoutMs'])) bad();
      if (!page) throw Error('browser_not_open');
      seenDialogs = [];
      try {
        const r = await this._action(args, opts);
        return seenDialogs.length && r && typeof r === 'object' && !r.status ? {...r, dialogs: seenDialogs} : r;
      } catch (e) {
        if (e?.dialog && pendingDialog) return {...dialogStatus(), ...(seenDialogs.length ? {dialogs: seenDialogs} : {})};
        throw e;
      }
    },
    async _action(args, {consented = false} = {}) {
      if (args.action === 'dialog') {
        if (!pendingDialog) throw Error('no_dialog_open');
        if (!['accept', 'dismiss'].includes(args.value) || (args.text !== undefined && (typeof args.text !== 'string' || args.text.length > 500))) bad();
        const accept = args.value === 'accept';
        if (accept && !consented && consent) {
          const risk = classifyBrowserRisk({label: pendingDialog.message});
          if (risk) return consent.requestGrant({what: risk.what, replay: {tool: 'browser_action', args},
            target: `браузер NEXUS: подтвердить диалог «${pendingDialog.message.slice(0, 120)}» (${risk.what === 'browser_financial' ? 'может создать платное обязательство' : 'отправка/публикация/удаление от вашего имени'})`,
            apply: () => this.browser_action(args, {consented: true})});
        }
        const d = pendingDialog; pendingDialog = null;
        await d.cdp.send('Page.handleJavaScriptDialog', {accept, ...(accept && d.type === 'prompt' && args.text !== undefined ? {promptText: args.text} : {})});
        await sleep(300); await waitLoad();
        if (pendingDialog) throw Object.assign(Error('dialog_open'), {dialog: true});
        const url = await guardUrl();
        return {done: true, action: 'dialog', answered: args.value, dialog: {type: d.type, message: d.message}, url, title: await evaluate('document.title')};
      }
      if (pendingDialog) throw Object.assign(Error('dialog_open'), {dialog: true});
      await guardUrl();
      // 0.5.1 D2/D3: the step that creates a paid obligation, or sends/publishes/deletes on the owner's behalf, needs consent.
      if (!consented && consent && ['click', 'press'].includes(args.action)) {
        const facts = await evaluate(FACTS_JS(args.action === 'click' ? args.ref : null, args.key));
        const risk = facts && classifyBrowserRisk(facts);
        if (risk) {
          const host = await evaluate('location.host');
          const label = facts.label || (args.action === 'press' ? 'отправка формы' : 'элемент без подписи');
          const why = risk.what === 'browser_financial' ? 'может создать платное обязательство' : 'отправка/публикация/удаление от вашего имени';
          return consent.requestGrant({what: risk.what, replay: {tool: 'browser_action', args},
            target: `браузер NEXUS: ${args.action === 'click' ? 'нажать' : 'Enter для'} «${label}» на ${host} (${why})`,
            apply: () => this.browser_action(args, {consented: true})});
        }
      }
      // NEXT NX-052-11 / FR-06.5: done:true is only «attempted»; result_verified compares observed state before/after.
      const FP = `(() => ({u: location.href, t: document.title, n: document.getElementsByTagName('*').length, l: document.body ? document.body.innerText.length : 0, y: Math.round(scrollY), a: document.activeElement ? (document.activeElement.tagName + '|' + (document.activeElement.value ?? '') + '|' + (document.activeElement.checked ?? '')).slice(0, 300) : ''}))()`;
      const elState = ref => `(() => { const e = ${refExpr(ref)}; return e ? {v: 'value' in e ? String(e.value).slice(0, 2000) : null, c: e.checked ?? null} : null; })()`;
      const before = args.action === 'wait' ? null : await evaluate(FP).catch(() => null);
      const elBefore = args.action === 'click' && typeof args.ref === 'string' ? await evaluate(elState(args.ref)).catch(() => null) : null;
      switch (args.action) {
        case 'wait': {
          const ms = args.timeoutMs ?? 10_000; if (!Number.isInteger(ms) || ms < 100 || ms > 30_000) bad();
          if (args.text !== undefined && (typeof args.text !== 'string' || !args.text || args.text.length > 200)) bad();
          const end = Date.now() + ms; let found = args.text === undefined;
          while (Date.now() < end) {
            await waitLoad();
            if (args.text === undefined) break;
            if (await evaluate(`(document.body ? document.body.innerText : '').includes(${JSON.stringify(args.text)})`)) { found = true; break; }
            await sleep(300);
          }
          const url = await guardUrl();
          return {done: true, action: 'wait', found, url, title: await evaluate('document.title'), observed_url: url, result_verified: found};
        }
        case 'select': {
          if (typeof args.value !== 'string' || args.value.length > 200) bad();
          const ok = await evaluate(`(() => { const e = ${refExpr(args.ref)}; if (!e) return 'missing'; if (e.tagName !== 'SELECT') return 'not_select'; const o = [...e.options].find(o => o.value === ${JSON.stringify(args.value)} || o.text.trim() === ${JSON.stringify(args.value)}); if (!o) return 'no_option'; e.value = o.value; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); return 'ok'; })()`);
          if (ok !== 'ok') throw Error(ok === 'missing' ? 'ref_not_found' : ok);
          break;
        }
        case 'click': {
          const r = await evaluate(`(() => { const e = ${refExpr(args.ref)}; if (!e) return null; e.scrollIntoView({block: 'center'}); const b = e.getBoundingClientRect(); return {x: b.x + b.width / 2, y: b.y + b.height / 2}; })()`);
          if (!r) throw Error('ref_not_found');
          for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await untilDialog(page.send('Input.dispatchMouseEvent', {type, x: r.x, y: r.y, button: 'left', clickCount: 1}, 30_000));
          await sleep(300); await waitLoad();
          break;
        }
        case 'type': {
          if (typeof args.text !== 'string' || args.text.length > 2000) bad();
          if (args.clear !== undefined && typeof args.clear !== 'boolean') bad();
          const ok = await evaluate(`(() => { const e = ${refExpr(args.ref)}; if (!e) return 'missing'; if ((e.getAttribute('type') || '').toLowerCase() === 'password' || /^(cc-|one-time-code|current-password|new-password)/.test(e.autocomplete || '') || new RegExp(${JSON.stringify(SECRET_FIELD_RE.source)}, 'i').test((e.name || '') + ' ' + (e.id || '') + ' ' + (e.getAttribute('aria-label') || ''))) return 'password'; e.focus(); ${args.clear ? "if ('value' in e) { e.value = ''; e.dispatchEvent(new Event('input', {bubbles: true})); }" : ''} return 'ok'; })()`);
          if (ok === 'missing') throw Error('ref_not_found');
          if (ok === 'password') throw Error('sensitive_field_refused');
          await page.send('Input.insertText', {text: args.text});
          break;
        }
        case 'press': {
          const code = KEYS[args.key]; if (!code) bad();
          const key = args.key === 'Space' ? ' ' : args.key;
          for (const type of ['keyDown', 'keyUp']) await untilDialog(page.send('Input.dispatchKeyEvent', {type, key, code: args.key, windowsVirtualKeyCode: code, ...(args.key === 'Enter' && type === 'keyDown' ? {text: '\r'} : {})}));
          await sleep(300); await waitLoad();
          break;
        }
        case 'navigate': {
          if (typeof args.url !== 'string' || !urlAllowed(args.url, {allowPrivate})) throw Error('url_not_allowed');
          await page.send('Page.navigate', {url: args.url}); await waitLoad();
          break;
        }
        case 'back': await evaluate('history.back()'); await sleep(500); await waitLoad(); break;
        case 'scroll': {
          const n = args.amount ?? 1; if (!Number.isInteger(n) || n < -20 || n > 20) bad();
          await evaluate(`window.scrollBy(0, ${n} * window.innerHeight * 0.8)`); break;
        }
        default: bad();
      }
      const url = await guardUrl();
      const after = await evaluate(FP).catch(() => null);
      const observed_state = before && after ? {urlChanged: before.u !== after.u, titleChanged: before.t !== after.t,
        domChanged: before.n !== after.n || before.l !== after.l, scrolled: before.y !== after.y, focusChanged: before.a !== after.a} : null;
      let verified = null;
      if (args.action === 'navigate') { try { const w = new URL(args.url), g = new URL(url); verified = w.host === g.host && g.pathname.startsWith(w.pathname.replace(/\/$/, '')); } catch { verified = false; } }
      else if (args.action === 'type' || args.action === 'select') {
        const st = await evaluate(elState(args.ref)).catch(() => null);
        verified = !!st && st.v !== null && (args.action === 'type' ? st.v.includes(args.text) : st.v !== '' );
      } else if (args.action === 'scroll') verified = !!observed_state?.scrolled;
      else if (args.action === 'back') verified = !!observed_state?.urlChanged;
      else if (args.action === 'click' || args.action === 'press') {
        const elAfter = args.action === 'click' && typeof args.ref === 'string' ? await evaluate(elState(args.ref)).catch(() => null) : null;
        const elChanged = !!elBefore && !!elAfter && (elBefore.v !== elAfter.v || elBefore.c !== elAfter.c);
        verified = !!observed_state && (observed_state.urlChanged || observed_state.titleChanged || observed_state.domChanged || observed_state.focusChanged || elChanged);
      }
      return {done: true, action: args.action, url, title: await evaluate('document.title'), observed_url: url, observed_state, result_verified: verified,
        ...(verified === false ? {hint: 'No observable effect: done only means the input was sent. Check with browser_snapshot before assuming success.'} : {})};
    },
    /** 0.5.0: tabs of the NEXUS browser (separate profile — every tab in it belongs to NEXUS). */
    async browser_tabs(args) {
      requireCap(caps, 'browser');
      if (!onlyKeys(args, ['action', 'id', 'url']) || !['list', 'new', 'switch', 'close'].includes(args.action)) bad();
      if (args.action === 'new') {
        if (args.url !== undefined && (typeof args.url !== 'string' || !urlAllowed(args.url, {allowPrivate}))) throw Error('url_not_allowed');
        await ensure();
        const {targetId} = await browserWs.send('Target.createTarget', {url: 'about:blank'});
        const t = (await pages()).find(x => x.id === targetId);
        if (!t) throw Error('tab_not_found');
        await attach(t);
        if (args.url) { await page.send('Page.navigate', {url: args.url}); await waitLoad(); await guardUrl(); }
      } else if (args.action !== 'list') {
        if (typeof args.id !== 'string' || !/^[0-9a-f]{8}$/i.test(args.id)) bad();
        if (!browserWs) throw Error('browser_not_open');
        const t = (await pages()).find(x => shortId(x.id) === args.id.toLowerCase());
        if (!t) throw Error('tab_not_found');
        if (args.action === 'switch') { await attach(t); await browserWs.send('Target.activateTarget', {targetId: t.id}).catch(() => {}); }
        else {
          await browserWs.send('Target.closeTarget', {targetId: t.id});
          // 0.5.2: Edge answers closeTarget before the target is gone (Windows CI 41466231727: list still had 2 tabs).
          for (let i = 0; i < 20 && (await pages()).some(x => x.id === t.id); i++) await new Promise(r => setTimeout(r, 100));
          if (t.id === currentTarget) { page?.close(); page = null; const rest = await pages(); if (rest[0]) await attach(rest[0]); }
          const left = await pages();
          if (!left.length) { await this.cleanupSession('last_tab_closed').catch(() => gone()); gone(); return {tabs: [], open: false, closed: args.id.toLowerCase()}; }
        }
      } else if (!browserWs) return {tabs: [], open: false};
      const all = await pages();
      if (!browserWs) return {tabs: [], open: false};
      const tabs = all.map(t => ({id: shortId(t.id), url: String(t.url).slice(0, 200), title: String(t.title).slice(0, 120), current: t.id === currentTarget}));
      return {tabs, open: true};
    },
    egressStats: () => proxy?.stats ?? null,
    /**
     * 0.5.1: end of a work session (finish_task / Stop / idle / error) — close NEXUS's own Edge completely:
     * 1) CDP Browser.close (graceful, whole instance); 2) if still alive, kill its process tree by PID;
     * 3) sweep any process still running with OUR profile dir (children, leftovers of a crashed Host).
     * The owner's Edge is never touched: it has neither our PID nor our --user-data-dir.
     */
    async cleanupSession() {
      const wasOpen = !!(proc || browserWs);
      const steps = [];
      const p = proc, pid = proc?.pid;
      if (browserWs && !browserWs.closed) { try { await browserWs.send('Browser.close', {}, 3000); steps.push('cdp_browser_close'); } catch { steps.push('cdp_close_failed'); } }
      if (p) {
        const exited = await new Promise(res => { if (p.exitCode !== null || p.signalCode) return res(true); const t = setTimeout(() => res(false), 4000); p.once('exit', () => { clearTimeout(t); res(true); }); });
        if (!exited && pid) { killFn([pid], {tree: true}); steps.push('kill_tree'); }
      }
      page?.close(); browserWs?.close(); proxy?.close();
      proc = null; page = null; browserWs = null; proxy = null; port = null; currentTarget = null;
      // Sweep our profile: always after our browser ran; otherwise once per Host (leftovers of a crashed Host).
      if (!wasOpen && sweptOnce) return {wasOpen, steps, swept: 0, remaining: 0};
      sweptOnce = true;
      if (wasOpen) await sleep(300);
      let left = []; try { left = findPids(); } catch { /* listing failed: report unknown */ left = null; }
      let swept = 0;
      if (left?.length) { swept = killFn(left, {tree: false}); steps.push('sweep_profile'); await sleep(300); try { left = findPids(); } catch { left = null; } }
      return {wasOpen, steps, swept, remaining: left === null ? 'unknown' : left.length};
    },
    stop() {
      const pid = proc?.pid;
      page?.close(); browserWs?.close(); try { proc?.kill(); } catch { /* gone */ }
      if (pid && platform === 'win32') killFn([pid], {tree: true}); // children otherwise survive the main process
      proxy?.close(); proc = null; page = null; browserWs = null; proxy = null;
    },
  };
}
