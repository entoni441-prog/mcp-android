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
import {spawn} from 'node:child_process';
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
    const c = new Cdp(); c.ws = new WebSocket(url); c.seq = 0; c.pending = new Map();
    await new Promise((res, rej) => { c.ws.onopen = res; c.ws.onerror = () => rej(Error('cdp_connect_failed')); });
    c.ws.onmessage = ev => { const m = JSON.parse(ev.data); const p = m.id && c.pending.get(m.id); if (p) { c.pending.delete(m.id); m.error ? p.rej(Error('cdp_error')) : p.res(m.result); } };
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
export function createBrowser({caps, home, platform = process.platform, browserPath, headless = false, allowPrivate = false, proxyOptions = {}, spawnFn = spawn, onOwnedPid = () => {}}) {
  const profile = path.join(home, 'edge-profile');
  let proc = null, page = null, browserWs = null, proxy = null;

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
    const port = Number(lines[0]);
    browserWs = await Cdp.connect(`ws://127.0.0.1:${port}${lines[1]}`);
    await browserWs.send('Browser.setDownloadBehavior', {behavior: 'deny'}).catch(() => {});
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = list.find(t => t.type === 'page');
    if (!target) throw Error('no_page_target');
    page = await Cdp.connect(target.webSocketDebuggerUrl);
    await page.send('Page.enable'); await page.send('Runtime.enable');
    return page;
  }
  const evaluate = async (expr) => {
    const r = await (await ensure()).send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true});
    if (r.exceptionDetails) throw Error('page_script_failed');
    return r.result?.value;
  };
  async function waitLoad() {
    for (let i = 0; i < 60; i++) { try { if (await evaluate('document.readyState') === 'complete') return; } catch { /* navigating */ } await sleep(250); }
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
      await guardUrl();
      const snap = await evaluate(SNAPSHOT_JS);
      if (!args.screenshot) return snap;
      const shot = await page.send('Page.captureScreenshot', {format: 'jpeg', quality: 60});
      return {content: [{type: 'image', data: shot.data, mimeType: 'image/jpeg'}, {type: 'text', text: JSON.stringify(snap)}], structured: snap};
    },
    async browser_action(args) {
      requireCap(caps, 'browser');
      if (!onlyKeys(args, ['action', 'ref', 'text', 'key', 'url', 'clear', 'amount'])) bad();
      if (!page) throw Error('browser_not_open');
      await guardUrl();
      switch (args.action) {
        case 'click': {
          const r = await evaluate(`(() => { const e = ${refExpr(args.ref)}; if (!e) return null; e.scrollIntoView({block: 'center'}); const b = e.getBoundingClientRect(); return {x: b.x + b.width / 2, y: b.y + b.height / 2}; })()`);
          if (!r) throw Error('ref_not_found');
          for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', {type, x: r.x, y: r.y, button: 'left', clickCount: 1});
          await sleep(300); await waitLoad();
          break;
        }
        case 'type': {
          if (typeof args.text !== 'string' || args.text.length > 2000) bad();
          if (args.clear !== undefined && typeof args.clear !== 'boolean') bad();
          const ok = await evaluate(`(() => { const e = ${refExpr(args.ref)}; if (!e) return 'missing'; if ((e.getAttribute('type') || '').toLowerCase() === 'password' || e.autocomplete === 'cc-number') return 'password'; e.focus(); ${args.clear ? "if ('value' in e) { e.value = ''; e.dispatchEvent(new Event('input', {bubbles: true})); }" : ''} return 'ok'; })()`);
          if (ok === 'missing') throw Error('ref_not_found');
          if (ok === 'password') throw Error('sensitive_field_refused');
          await page.send('Input.insertText', {text: args.text});
          break;
        }
        case 'press': {
          const code = KEYS[args.key]; if (!code) bad();
          const key = args.key === 'Space' ? ' ' : args.key;
          for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', {type, key, code: args.key, windowsVirtualKeyCode: code, ...(args.key === 'Enter' && type === 'keyDown' ? {text: '\r'} : {})});
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
      return {done: true, action: args.action, url, title: await evaluate('document.title')};
    },
    egressStats: () => proxy?.stats ?? null,
    stop() { page?.close(); browserWs?.close(); try { proc?.kill(); } catch { /* gone */ } proxy?.close(); proc = null; page = null; proxy = null; },
  };
}
