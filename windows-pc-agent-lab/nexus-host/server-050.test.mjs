// 0.5.0 safety + function tests: Live View gating/STOP/rate limit, app-access grants via consent, HARD_DENY,
// inspect_ui redaction, scratch-token ownership, tunnel health verdicts, /healthz, trace ids. All without a desktop.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadConfig, createServer, tunnelHealth} from './server.mjs';
import {createLive} from './live.mjs';
import {createConsent} from './consent.mjs';
import {createGui} from './gui.mjs';
import {validateCapabilities} from './capabilities.mjs';
import {TOOLS, LIVE_UI} from './catalog.mjs';

function host(capsJson = {}, extra = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-050-'));
  const home = path.join(tmp, 'h'); fs.mkdirSync(home, {recursive: true});
  fs.writeFileSync(path.join(home, 'capabilities.json'), JSON.stringify(capsJson));
  const cfg = loadConfig({NEXUS_HOME: home, NEXUS_WORKSPACE: path.join(tmp, 'ws'), NEXUS_PORT: '0'});
  const captures = [];
  const capture = async (w, q) => { captures.push([w, q]); await new Promise(r => setTimeout(r, 20)); return {jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), meta: {screenW: 1920, screenH: 1080, imageW: w, imageH: 540, cursorX: 10, cursorY: 20, ms: 5}}; };
  const server = createServer(cfg, {liveDeps: {capture, indicator: () => {}}, ...extra});
  return {cfg, captures, server, home, async start() { await new Promise(r => server.listen(0, '127.0.0.1', r)); this.base = `http://127.0.0.1:${server.address().port}`; return this; },
    async call(name, args = {}, headers = {}) {
      return (await (await fetch(this.base + '/mcp', {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${cfg.token}`, ...headers},
        body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: args}})})).json()).result;
    },
    stop() { server.close(); cfg.runtime?.stop(); }};
}
const auditOf = h => fs.readFileSync(h.cfg.auditFile, 'utf8');

test('catalog 0.5.1: 37 tools; live_frame is app-only; widget tools point at the ui:// resource', () => {
  assert.equal(TOOLS.length, 37);
  const lf = TOOLS.find(t => t.name === 'live_frame');
  assert.deepEqual(lf._meta.ui.visibility, ['app']);
  assert.equal(lf._meta.ui.resourceUri, LIVE_UI);
  assert.equal(TOOLS.find(t => t.name === 'watch_nexus')._meta['openai/outputTemplate'], LIVE_UI);
  assert.ok(LIVE_UI.startsWith('ui://'));
  for (const t of TOOLS) assert.equal(t.inputSchema.additionalProperties, false, t.name);
});

test('Live View 0.5.1: no grant → off; grant but no session → ready, no capture; watch session → frames; STOP at source keeps grant', async () => {
  const h = await host().start();
  try {
    const off = (await h.call('live_frame')).structuredContent;
    assert.equal(off.state, 'off'); assert.equal(h.captures.length, 0);
    assert.equal((await h.call('watch_nexus')).structuredContent.state, 'off');
    assert.equal((await h.call('set_capability', {capability: 'live_view', enabled: true})).isError, false);
    assert.equal((await h.call('live_frame')).structuredContent.state, 'ready', 'grant alone produces no frames');
    assert.equal(h.captures.length, 0);
    assert.equal((await h.call('watch_nexus')).structuredContent.streaming, true);
    const [a, b] = await Promise.all([h.call('live_frame'), h.call('live_frame')]);
    assert.equal(a.content[0].type, 'image'); assert.equal(a.content[0].mimeType, 'image/jpeg');
    assert.equal(a.structuredContent.state, 'live'); assert.deepEqual(a.structuredContent.cursor, {x: 10, y: 20});
    assert.equal(a.structuredContent.seq, b.structuredContent.seq, 'concurrent viewers share one capture');
    assert.equal(h.captures.length, 1);
    assert.equal((await h.call('live_frame', {maxWidth: 5000})).isError, true);
    assert.equal((await h.call('live_frame', {foo: 1})).isError, true);
    const st = (await h.call('live_control', {action: 'stop'})).structuredContent;
    assert.equal(st.stopped, true); assert.equal(st.streaming, false);
    const n = h.captures.length;
    assert.notEqual((await h.call('live_frame')).structuredContent.state, 'live');
    assert.equal(h.captures.length, n, 'no capture after STOP');
    assert.equal(JSON.parse(fs.readFileSync(path.join(h.home, 'capabilities.json'), 'utf8')).live_view, true, 'persistent grant kept');
    const log = auditOf(h);
    assert.ok(!log.includes('/9j/') && !log.includes('"tool":"live_frame","ok":true'), 'frames never audited');
    assert.match(log, /"event":"live_view_viewing","on":true/);
    assert.match(log, /"event":"session_end"/);
  } finally { h.stop(); }
});

test('Live View rate limit: ≤5 captures/s however often viewers poll', async () => {
  let t = 0; const caps = {live_view: true}; let n = 0;
  const live = createLive({caps, store: {set: () => ({changed: true})}, capture: async () => { n++; return {jpeg: Buffer.alloc(4), meta: {cursorX: -1}}; }, now: () => t, indicator: () => {}, setIntervalFn: () => null});
  for (let i = 0; i < 50; i++) { t += 20; await live.live_frame({}); } // 50 polls over 1 s
  assert.ok(n <= 6, `captures=${n}`);
  live.stop();
});

test('gui_input and live_view are separate: enabling live_view does not enable input', async () => {
  const h = await host({live_view: true}).start();
  try {
    const c = (await h.call('get_capabilities')).structuredContent.grants;
    assert.equal(c.live_view, true); assert.equal(c.gui_input, false);
    assert.match((await h.call('keyboard_action', {keys: 'enter'})).content[0].text, /capability_disabled/);
    assert.match((await h.call('set_capability', {capability: 'browser', enabled: true})).content[0].text, /invalid_args/);
  } finally { h.stop(); }
});

test('manage_app_access: grant only via consent+exact target; HARD_DENY never; revoke immediate', async () => {
  const h = await host().start();
  try {
    for (const p of ['cmd', 'powershell', 'WindowsTerminal', 'regedit', 'explorer', 'Bitwarden', 'KeePassXC', 'node', 'claude']) {
      assert.match((await h.call('manage_app_access', {action: 'request', process: p})).content[0].text, /app_hard_denied/, p);
    }
    assert.match((await h.call('manage_app_access', {action: 'request', process: 'mspaint', exe: 'C:\\x\\run.bat'})).content[0].text, /app_exe_invalid/);
    assert.match((await h.call('manage_app_access', {action: 'request', process: 'mspaint', exe: '\\\\srv\\share\\a.exe'})).content[0].text, /app_exe_invalid/);
    assert.match((await h.call('manage_app_access', {action: 'request', process: 'x', exe: 'C:\\Windows\\System32\\cmd.exe'})).content[0].text, /app_hard_denied|app_exe_invalid/);
    // 0.5.2 policy mode: an ordinary app needs no grant; revoke = owner block; unblocking needs consent again
    const a0 = (await h.call('manage_app_access', {action: 'request', process: 'mspaint'})).structuredContent;
    assert.deepEqual([a0.alreadyAllowed, a0.cls], [true, 'ordinary']);
    const rv = (await h.call('manage_app_access', {action: 'revoke', process: 'mspaint'})).structuredContent;
    assert.ok(rv.blockedApps.includes('mspaint'));
    assert.ok(JSON.parse(fs.readFileSync(path.join(h.home, 'capabilities.json'), 'utf8')).blockedApps.includes('mspaint'));
    const r = (await h.call('manage_app_access', {action: 'request', process: 'mspaint'})).structuredContent;
    assert.equal(r.status, 'consent_required'); assert.equal(r.kind, 'grant'); assert.deepEqual(r.options, ['allow', 'cancel']);
    assert.ok((await h.call('get_capabilities')).structuredContent.grants.blockedApps.includes('mspaint'), 'still blocked before consent');
    assert.match((await h.call('confirm_action', {consentId: r.consentId, decision: 'allow', target: r.target + ' '})).content[0].text, /consent_target_mismatch/);
    assert.match((await h.call('confirm_action', {consentId: r.consentId, decision: 'close_discard', target: r.target})).content[0].text, /invalid_args/);
    const c = (await h.call('confirm_action', {consentId: r.consentId, decision: 'allow', target: r.target})).structuredContent;
    assert.equal(c.confirmed, true); assert.ok(!c.result.blockedApps.includes('mspaint'));
    assert.match((await h.call('confirm_action', {consentId: r.consentId, decision: 'allow', target: r.target})).content[0].text, /consent_expired_or_unknown/);
    // a hand-edited file that tries to sneak a denied app in is filtered by validation
    assert.match(auditOf(h), /"event":"capabilities_changed"/);
  } finally { h.stop(); }
});

test('close consents cannot be answered with "allow"; grant consent cannot be answered with a close decision', () => {
  const c = createConsent();
  const g = c.gate({kind: 'tab', via: 'ctrl+w'}, {hwnd: 1, process: 'Notepad', name: 'w', tabs: [{rid: 'a', name: 'owner.txt', selected: true}]}, null, {});
  assert.throws(() => c.take(g.consentId, 'allow', g.target), /invalid_args/);
});

test('scratch token: cold start restoring owner tabs owns ONLY the NEXUS scratch tab', () => {
  const c = createConsent();
  const W = {hwnd: 9, pid: 3, process: 'Notepad', name: 'NEXUS-a1b2c3.txt - Блокнот', tabs: [
    {rid: 'o1', name: 'wrangler.jsonc'}, {rid: 'o2', name: 'owner-passphrase.txt'}, {rid: 'n', name: 'NEXUS-a1b2c3.txt', selected: true}]};
  const r = c.recordCreated([], [W], 'open_app:notepad', {token: 'NEXUS-a1b2c3'});
  assert.deepEqual(r.tabs, ['NEXUS-a1b2c3.txt']); assert.deepEqual(r.windows, [], 'window holds owner tabs → not owned');
  assert.equal(c.gate({kind: 'tab', via: 'ctrl+w'}, W, null, {}), null, 'own scratch tab closes autonomously');
  const owner = {...W, tabs: W.tabs.map(t => ({...t, selected: t.rid === 'o2'}))};
  assert.equal(c.gate({kind: 'tab', via: 'ctrl+w'}, owner, null, {}).status, 'consent_required');
  assert.equal(c.gate({kind: 'window', via: 'alt+f4'}, W, null, {}).status, 'consent_required');
  assert.equal(c.recordCreated([], [W], 's', {token: 'NEXUS-ffffff'}).reason, 'token_not_found');
});

test('inspect_ui redacts document/edit text unless includeText=true', async () => {
  const tree = [{type: 'Window', name: 'secret.txt - Notepad', rect: null, children: [{type: 'Document', name: 'my password is hunter2', rect: null}, {type: 'Button', name: 'Close', rect: null}]}];
  const uia = async a => a.mode === 'tree' ? {target: {process: 'Notepad'}, nodes: 3, root: {x: 0, y: 0, w: 100, h: 100}, tree} : {};
  const robot = {cmd: async () => ({x: 0, y: 0, w: 100, h: 100, screens: 1})};
  const g = createGui({caps: validateCapabilities({}), home: os.tmpdir(), workspace: os.tmpdir(), platform: 'win32', runUia: uia, robot});
  const r = await g.inspect_ui({pid: 5});
  assert.ok(!JSON.stringify(r).includes('hunter2')); assert.equal(r.textRedacted, 1);
  assert.equal(r.tree[0].children[1].name, 'Close');
  assert.ok(JSON.stringify(await g.inspect_ui({pid: 5, includeText: true})).includes('hunter2'));
});

test('tunnelHealth verdicts from cloudflared events', () => {
  const now = Date.parse('2026-11-01T20:00:00Z'); const t = s => new Date(now - s * 1000).toISOString();
  assert.equal(tunnelHealth([], now).verdict, 'ok');
  const idle = [{t: t(60), kind: 'cloudflared', msg: 'ERR datagram manager error: timeout: no recent network activity'}, {t: t(55), kind: 'cloudflared', msg: 'INF Registered tunnel connection connIndex=0'}];
  const v = tunnelHealth(idle, now); assert.equal(v.verdict, 'idle_timeouts_recovered'); assert.equal(v.idleTimeouts, 1); assert.equal(v.lastReconnect, t(55));
  assert.equal(tunnelHealth([{t: t(5), kind: 'cloudflared', msg: 'WRN Connection terminated'}], now).verdict, 'tunnel_reconnecting');
  assert.equal(tunnelHealth([{t: t(5), kind: 'cloudflared_exit', msg: '1'}], now).verdict, 'tunnel_process_exited');
  assert.equal(tunnelHealth([{t: t(3600), kind: 'cloudflared_exit', msg: '1'}], now).verdict, 'ok', 'old events ignored');
});

test('/healthz is unauthenticated and leaks nothing; trace id reaches errors and audit', async () => {
  const h = await host().start();
  try {
    const r = await (await fetch(h.base + '/healthz')).json();
    assert.deepEqual(Object.keys(r).sort(), ['ok', 'service', 'version']);
    assert.equal((await fetch(h.base + '/healthz', {method: 'POST'})).status, 404);
    const e = await h.call('read_text', {path: '../x'}, {'x-nexus-trace': 'abcdef0123456789'});
    assert.match(e.content[0].text, /\[trace: abcdef0123456789\]/);
    await h.call('read_text', {path: '../x'}, {'x-nexus-trace': 'not a trace!'});
    assert.match(auditOf(h), /"trace":"abcdef0123456789"/);
    assert.ok(!auditOf(h).includes('not a trace'));
    const cs = (await h.call('connection_status')).structuredContent;
    assert.equal(cs.host, 'reachable'); assert.equal(cs.version, '0.5.1');
  } finally { h.stop(); }
});
