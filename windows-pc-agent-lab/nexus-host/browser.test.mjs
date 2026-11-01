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
