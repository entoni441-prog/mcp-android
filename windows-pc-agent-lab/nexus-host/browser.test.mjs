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
  const b = createBrowser({caps, home, browserPath: exe, headless: true, allowPrivate: true});
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
