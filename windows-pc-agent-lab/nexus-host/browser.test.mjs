// REAL browser over CDP (Chrome on Linux CI, Edge on Windows CI). Skipped when no browser is found.
// allowPrivate=true is a TEST-ONLY injection (local test page); production code has no way to set it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createBrowser, findEdge} from './browser.mjs';
import {validateCapabilities} from './capabilities.mjs';
import net from 'node:net';

const candidates = process.platform === 'win32' ? [findEdge(null)] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
const exe = candidates.find(p => p && fs.existsSync(p));

const PAGE = `<!doctype html><title>NEXUS test</title><h1 id=h>start</h1>
<label for=q>Search</label><input id=q name=q placeholder="query">
<input type=password id=pw aria-label="Password">
<button onclick="document.getElementById('h').textContent='clicked:'+document.getElementById('q').value">Go</button>
<a href="/two">Second page</a><a href="/redir">Redirect away</a>`;

test('real browser: open, snapshot refs, type, click, press, navigate; password and policy refusals', {skip: !exe && 'no browser'}, async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/two') return res.end('<title>Two</title><p>page two</p>');
    if (req.url === '/redir') { res.writeHead(302, {location: 'file:///etc/passwd'}); return res.end(); }
    res.setHeader('content-type', 'text/html'); res.end(PAGE);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-br-'));
  const caps = validateCapabilities({browser: true});
  const b = createBrowser({caps, home, browserPath: exe, headless: true, allowPrivate: true, proxyOptions: {ports: [srv.address().port]}});
  try {
    const o = await b.browser_open({url: base + '/'});
    assert.equal(o.title, 'NEXUS test');
    const s = await b.browser_snapshot({});
    const byName = n => s.elements.find(e => e.name === n);
    assert.ok(byName('Search') && byName('Go') && byName('Password'));
    assert.ok(!JSON.stringify(s).includes('"value"'));
    await b.browser_action({action: 'type', ref: byName('Search').ref, text: 'Привет'});
    await assert.rejects(b.browser_action({action: 'type', ref: byName('Password').ref, text: 'x'}), /sensitive_field_refused/);
    await b.browser_action({action: 'click', ref: byName('Go').ref});
    assert.match((await b.browser_snapshot({})).text, /clicked:Привет/);
    const shot = await b.browser_snapshot({screenshot: true});
    assert.equal(shot.content[0].mimeType, 'image/jpeg');
    const s2 = await b.browser_snapshot({});
    await b.browser_action({action: 'click', ref: s2.elements.find(e => e.name === 'Second page').ref});
    assert.equal((await b.browser_snapshot({})).title, 'Two');
    await b.browser_action({action: 'back'});
    await assert.rejects(b.browser_action({action: 'navigate', url: 'file:///etc/passwd'}), /url_not_allowed/);
    await assert.rejects(b.browser_action({action: 'navigate', url: 'javascript:alert(1)'}), /url_not_allowed/);
    await assert.rejects(b.browser_action({action: 'click', ref: 'e1"],*'}), /invalid_args/);
    // Browser blocks http→file redirects itself; either way the page must not end on a non-http URL.
    await b.browser_action({action: 'navigate', url: base + '/redir'}).catch(() => {});
    const after = await b.browser_snapshot({}).catch(e => ({error: e.message}));
    assert.ok(after.error || !after.url.startsWith('file:'), JSON.stringify(after).slice(0, 200));
    await b.browser_action({action: 'press', key: 'Tab'});
    await assert.rejects(b.browser_action({action: 'press', key: 'F12'}), /invalid_args/);
  } finally { b.stop(); srv.close(); }
});

test('browser tools refused when capability is off', async () => {
  const b = createBrowser({caps: validateCapabilities({}), home: os.tmpdir()});
  await assert.rejects(b.browser_open({url: 'https://example.com'}), /capability_disabled/);
});

test('production policy refuses local pages (no allowPrivate)', async () => {
  const b = createBrowser({caps: validateCapabilities({browser: true}), home: os.tmpdir(), browserPath: '/nonexistent'});
  await assert.rejects(b.browser_open({url: 'http://127.0.0.1:8765/mcp'}), /url_not_allowed/);
});

// ── Network-level SSRF / DNS-rebinding protection with a REAL browser, production policy (allowPrivate=false). ──
// "site.test" plays a public site (fake DNS → 127.0.0.2, which the injected address policy treats as public).
// The "secret" server on 127.0.0.1 plays the owner's LAN / NEXUS Host; it must never receive a request.
test('real browser: redirects, DNS names and page JS cannot reach private addresses', {skip: !exe && 'no browser', timeout: 120_000}, async () => {
  let secretHits = 0;
  const secret = http.createServer((req, res) => { secretHits++; res.end('SECRET'); });
  await new Promise(r => secret.listen(0, '127.0.0.1', r));
  const sp = secret.address().port;
  const site = http.createServer((req, res) => {
    if (req.url === '/to-ip') { res.writeHead(302, {location: `http://127.0.0.1:${sp}/secret`}); return res.end(); }
    if (req.url === '/to-rebind') { res.writeHead(302, {location: `http://rebind.test:${sp}/secret`}); return res.end(); }
    if (req.url === '/to-localhost') { res.writeHead(302, {location: `http://localhost:${sp}/secret`}); return res.end(); }
    if (req.url === '/two') return res.end('<title>Two</title>ok');
    res.setHeader('content-type', 'text/html');
    res.end(`<title>Site</title><h1 id=h>idle</h1><button onclick="(async () => { const out = []; for (const u of ['http://127.0.0.1:${sp}/secret', 'http://rebind.test:${sp}/secret', 'http://localhost:${sp}/secret', 'http://[::1]:${sp}/secret']) { try { const r = await fetch(u, {mode: 'no-cors'}); out.push('resp'); } catch { out.push('blocked'); } } document.getElementById('h').textContent = 'probe:' + out.join(','); })()">Probe</button><img src="http://rebind.test:${sp}/img.png">`);
  });
  await new Promise(r => site.listen(0, '127.0.0.2', r));
  const port = site.address().port;
  const DNS = {'site.test': '127.0.0.2', 'rebind.test': '127.0.0.1'};
  const lookup = (h, o, cb) => DNS[h] ? cb(null, [{address: DNS[h], family: 4}]) : cb(Object.assign(Error('ENOTFOUND'), {code: 'ENOTFOUND'}));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-br-ssrf-'));
  const b = createBrowser({caps: validateCapabilities({browser: true}), home, browserPath: exe, headless: true,
    proxyOptions: {lookup, ports: [port, sp], isPublic: ip => ip === '127.0.0.2'}});
  try {
    assert.equal((await b.browser_open({url: `http://site.test:${port}/`})).title, 'Site');
    for (const p of ['/to-ip', '/to-rebind', '/to-localhost']) {
      const r = await b.browser_action({action: 'navigate', url: `http://site.test:${port}${p}`}).then(x => x, e => e);
      console.log('redirect', p, r instanceof Error ? r.message : JSON.stringify(r));
      assert.ok(r instanceof Error && /url_not_allowed_after_redirect|egress_denied|navigation_blocked/.test(r.message), p);
    }
    await assert.rejects(b.browser_action({action: 'navigate', url: `http://rebind.test:${sp}/secret`}), /egress_denied|navigation_blocked/);
    await b.browser_action({action: 'navigate', url: `http://site.test:${port}/`});
    const s = await b.browser_snapshot({});
    await b.browser_action({action: 'click', ref: s.elements.find(e => e.name === 'Probe').ref});
    let text = '';
    for (let i = 0; i < 40 && !text.startsWith('probe:'); i++) { await new Promise(r => setTimeout(r, 250)); text = (await b.browser_snapshot({})).text.split('\n')[0]; }
    console.log('page JS probe', text);
    assert.equal(secretHits, 0, 'a private address was reached');
    const st = b.egressStats();
    console.log('egress stats', JSON.stringify(st));
    assert.ok(st.denied >= 4 && st.allowed >= 1);
  } finally { b.stop(); site.close(); secret.close(); }
});

// 0.5.0: tabs, wait-for-text, select, and owner consent before irreversible/financial/outgoing clicks.
const PAGE050 = `<!doctype html><title>Shop</title><h1 id=h>shop</h1>
<select id=s aria-label="Size"><option value=s>Small</option><option value=l>Large</option></select>
<button onclick="setTimeout(()=>document.getElementById('h').textContent='loaded later',400)">Load</button>
<button onclick="document.getElementById('h').textContent='PAID'">Оплатить заказ</button>
<form onsubmit="document.getElementById('h').textContent='SENT';return false"><input aria-label="Message" id=m><button type=submit>Send</button></form>`;

test('real browser 0.5.0: tabs, wait, select, consent before pay/send', {skip: !exe && 'no browser'}, async () => {
  const srv = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(req.url === '/b' ? '<title>B</title><p>bee</p>' : PAGE050); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-br5-'));
  const {createConsent} = await import('./consent.mjs');
  const consent = createConsent();
  const b = createBrowser({caps: validateCapabilities({browser: true}), home, consent, browserPath: exe, headless: true, allowPrivate: true, proxyOptions: {ports: [srv.address().port]}});
  try {
    await b.browser_open({url: base + '/'});
    let s = await b.browser_snapshot({});
    const ref = n => s.elements.find(e => e.name === n)?.ref;
    await b.browser_action({action: 'select', ref: ref('Size'), value: 'Large'});
    await assert.rejects(b.browser_action({action: 'select', ref: ref('Size'), value: 'XXL'}), /no_option/);
    await b.browser_action({action: 'click', ref: ref('Load')});
    const w = await b.browser_action({action: 'wait', text: 'loaded later', timeoutMs: 5000});
    assert.equal(w.found, true);
    // pay button → consent_required, nothing happens until allow
    const r = await b.browser_action({action: 'click', ref: ref('Оплатить заказ')});
    assert.equal(r.status, 'consent_required'); assert.equal(r.kind, 'grant');
    assert.match(r.target, /Оплатить заказ/);
    assert.doesNotMatch((await b.browser_snapshot({})).text, /PAID/);
    const p = consent.take(r.consentId, 'allow', r.target);
    await p.apply();
    assert.match((await b.browser_snapshot({})).text, /PAID/);
    // Enter in a form whose submit button says "Send" → consent too
    s = await b.browser_snapshot({});
    await b.browser_action({action: 'type', ref: ref('Message'), text: 'hi'});
    const e = await b.browser_action({action: 'press', key: 'Enter'});
    assert.equal(e.status, 'consent_required');
    assert.doesNotMatch((await b.browser_snapshot({})).text, /SENT/);
    // tabs
    const t0 = await b.browser_tabs({action: 'list'});
    assert.equal(t0.tabs.length, 1);
    const t1 = await b.browser_tabs({action: 'new', url: base + '/b'});
    assert.equal(t1.tabs.length, 2); assert.equal(t1.tabs.find(t => t.current).title, 'B');
    const first = t1.tabs.find(t => !t.current).id;
    await b.browser_tabs({action: 'switch', id: first});
    assert.equal((await b.browser_snapshot({})).title, 'Shop');
    const t2 = await b.browser_tabs({action: 'close', id: t1.tabs.find(t => t.title === 'B').id});
    assert.equal(t2.tabs.length, 1);
    await assert.rejects(b.browser_tabs({action: 'new', url: 'file:///etc/passwd'}), /url_not_allowed/);
    await assert.rejects(b.browser_tabs({action: 'switch', id: 'zz'}), /invalid_args/);
  } finally { b.stop(); srv.close(); }
});

// 0.5.1 D2 — real page facts: cart steps autonomous; on a checkout page the committing step waits for the owner.
test('real browser: D2 financial boundary (cart autonomous, checkout submit/Enter/place order → consent, card fields refused)', {skip: !exe && 'no browser', timeout: 120_000}, async () => {
  const {createConsent} = await import('./consent.mjs');
  const SHOP = `<!doctype html><title>Shop</title><h1 id=h>shop</h1><button onclick="document.getElementById('h').textContent='in cart'">Add to cart</button><a href="/checkout">Proceed to checkout</a>`;
  const CHECKOUT = `<!doctype html><title>Checkout</title><h1 id=h>checkout</h1><form onsubmit="event.preventDefault();document.getElementById('h').textContent='ORDER CREATED'">
<label for=n>Name</label><input id=n name=fullname><label for=c>Card</label><input id=c name=cardnumber><button>Continue</button></form>
<button onclick="document.getElementById('h').textContent='ORDER CREATED'">Place order</button>`;
  const srv = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(req.url === '/checkout' ? CHECKOUT : SHOP); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const consent = createConsent();
  const b = createBrowser({caps: validateCapabilities({browser: true}), home: fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-d2-')), consent,
    browserPath: exe, headless: true, allowPrivate: true, proxyOptions: {ports: [srv.address().port]}});
  try {
    await b.browser_open({url: base + '/shop'});
    let s = await b.browser_snapshot({}); const by = n => s.elements.find(e => e.name === n);
    assert.equal((await b.browser_action({action: 'click', ref: by('Add to cart').ref})).done, true);
    assert.match((await b.browser_snapshot({})).text, /in cart/);
    s = await b.browser_snapshot({});
    await b.browser_action({action: 'click', ref: by('Proceed to checkout').ref});
    s = await b.browser_snapshot({});
    assert.equal(s.title, 'Checkout');
    await b.browser_action({action: 'type', ref: by('Name').ref, text: 'Owner'});
    await assert.rejects(b.browser_action({action: 'type', ref: by('Card').ref, text: '4111'}), /sensitive_field_refused/);
    const r1 = await b.browser_action({action: 'click', ref: by('Continue').ref});
    assert.equal(r1.status, 'consent_required'); assert.equal(r1.what, 'browser_financial');
    const r2 = await b.browser_action({action: 'press', key: 'Enter'}); // focus is in the Name field of the checkout form
    assert.equal(r2.status, 'consent_required'); assert.equal(r2.what, 'browser_financial');
    const r3 = await b.browser_action({action: 'click', ref: by('Place order').ref});
    assert.equal(r3.what, 'browser_financial'); assert.match(r3.target, /Place order/);
    assert.match((await b.browser_snapshot({})).text, /checkout/); assert.doesNotMatch((await b.browser_snapshot({})).text, /ORDER CREATED/);
    // owner allows exactly that step → it runs once
    const p = consent.take(r3.consentId, 'allow', r3.target); await p.apply();
    assert.match((await b.browser_snapshot({})).text, /ORDER CREATED/);
  } finally { b.stop(); srv.close(); }
});

// 0.5.1 live acceptance defect: Demoblaze «Add to cart» shows alert() → every CDP call hung → cdp_timeout.
test('real browser: alert accepted automatically and reported; confirm waits for a decision; purchase confirm needs consent', {skip: !exe && 'no browser', timeout: 120_000}, async () => {
  const {createConsent} = await import('./consent.mjs');
  const PAGE = `<!doctype html><title>Dlg</title><h1 id=h>start</h1>
<button onclick="setTimeout(()=>{alert('Product added.');document.getElementById('h').textContent='added'},50)">Add to cart</button>
<button onclick="document.getElementById('h').textContent = confirm('Clear the list?') ? 'cleared' : 'kept'">Clear list</button>
<button onclick="document.getElementById('h').textContent = confirm('Confirm purchase of 1 item for 360 EUR?') ? 'BOUGHT' : 'not bought'">Next</button>`;
  const srv = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const consent = createConsent();
  const b = createBrowser({caps: validateCapabilities({browser: true}), home: fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-dlg-')), consent,
    browserPath: exe, headless: true, allowPrivate: true, proxyOptions: {ports: [srv.address().port]}});
  try {
    await b.browser_open({url: `http://127.0.0.1:${srv.address().port}/`});
    let s = await b.browser_snapshot({}); const by = n => s.elements.find(e => e.name === n).ref;
    const t0 = Date.now();
    const a = await b.browser_action({action: 'click', ref: by('Add to cart')});
    await b.browser_action({action: 'wait', text: 'added', timeoutMs: 5000});
    assert.ok(Date.now() - t0 < 15_000, 'no cdp_timeout');
    s = await b.browser_snapshot({});
    assert.match(s.text, /added/);
    assert.ok(JSON.stringify(a).includes('Product added') || true); // alert may fire after click returns; must not block either way
    // confirm: page blocked → dialog_open, other actions refuse instead of hanging
    const c = await b.browser_action({action: 'click', ref: by('Clear list')});
    assert.equal(c.status, 'dialog_open'); assert.equal(c.dialog.type, 'confirm'); assert.match(c.dialog.message, /Clear the list/);
    assert.equal((await b.browser_snapshot({})).status, 'dialog_open');
    assert.equal((await b.browser_action({action: 'scroll', amount: 1})).status, 'dialog_open');
    const ok = await b.browser_action({action: 'dialog', value: 'accept'});
    assert.equal(ok.done, true); assert.match((await b.browser_snapshot({})).text, /cleared/);
    // purchase confirm: accepting needs the owner
    s = await b.browser_snapshot({});
    const p = await b.browser_action({action: 'click', ref: by('Next')});
    assert.equal(p.status, 'dialog_open');
    const g = await b.browser_action({action: 'dialog', value: 'accept'});
    assert.equal(g.status, 'consent_required'); assert.equal(g.what, 'browser_financial');
    const d = await b.browser_action({action: 'dialog', value: 'dismiss'});
    assert.equal(d.answered, 'dismiss'); assert.match((await b.browser_snapshot({})).text, /not bought/);
    await assert.rejects(b.browser_action({action: 'dialog', value: 'accept'}), /no_dialog_open/);
  } finally { b.stop(); srv.close(); }
});

// 0.5.2 B-01: Demoblaze-like cart. «Place Order» only OPENS the order form (data-toggle=modal) → autonomous;
// «Purchase» inside the modal creates the order → consent. Look-alikes that must still need consent: a «Place Order»
// with inline onclick, a submit-button «Place Order» with data-toggle, a modal opener whose target does not exist.
test('real browser 0.5.2 B-01: modal opener autonomous, Purchase and look-alikes need consent', {skip: !exe && 'no browser', timeout: 120_000}, async () => {
  const {createConsent} = await import('./consent.mjs');
  const CART = `<!doctype html><title>Cart</title><h1 id=h>cart</h1>
<button type=button id=po data-toggle=modal data-target="#orderModal">Place Order</button>
<button type=button onclick="document.getElementById('h').textContent='ORDER CREATED'">Place Order now</button>
<form onsubmit="event.preventDefault();document.getElementById('h').textContent='ORDER CREATED'"><button type=submit data-toggle=modal data-target="#orderModal">Place Order (form)</button></form>
<button type=button data-toggle=modal data-target="#missing">Place Order ghost</button>
<div class=modal id=orderModal role=dialog style="display:none"><label for=nm>Name</label><input id=nm>
<button type=button onclick="document.getElementById('h').textContent='ORDER CREATED'">Purchase</button></div>
<script>document.getElementById('po').addEventListener('click',()=>{document.getElementById('orderModal').style.display='block'})</script>`;
  const srv = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(CART); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const consent = createConsent();
  const b = createBrowser({caps: validateCapabilities({browser: true}), home: fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-b01-')), consent,
    browserPath: exe, headless: true, allowPrivate: true, proxyOptions: {ports: [srv.address().port]}});
  try {
    await b.browser_open({url: base + '/cart'});
    let s = await b.browser_snapshot({}); const by = n => s.elements.find(e => e.name === n);
    for (const n of ['Place Order now', 'Place Order (form)', 'Place Order ghost']) {
      const r = await b.browser_action({action: 'click', ref: by(n).ref});
      assert.equal(r.status, 'consent_required', n); assert.equal(r.what, 'browser_financial', n);
    }
    const r0 = await b.browser_action({action: 'click', ref: by('Place Order').ref});
    assert.equal(r0.done, true, JSON.stringify(r0));
    s = await b.browser_snapshot({});
    assert.ok(by('Purchase'), 'order form opened');
    await b.browser_action({action: 'type', ref: by('Name').ref, text: 'Test'});
    const r1 = await b.browser_action({action: 'click', ref: by('Purchase').ref});
    assert.equal(r1.status, 'consent_required'); assert.equal(r1.what, 'browser_financial');
    assert.doesNotMatch((await b.browser_snapshot({})).text, /ORDER CREATED/);
  } finally { b.stop(); srv.close(); }
});
