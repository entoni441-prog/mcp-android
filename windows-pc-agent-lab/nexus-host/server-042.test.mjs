// 0.4.2 over HTTP: consent_required → confirm_action replay; target echo; host_diagnostics; audit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadConfig, createServer} from './server.mjs';
import {sanitize} from './nexus.mjs';

test('process close of a non-NEXUS app → consent_required; confirm_action executes exactly once; audit trail', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-042-'));
  const cfg = loadConfig({NEXUS_HOME: path.join(tmp, 'h'), NEXUS_WORKSPACE: path.join(tmp, 'ws'), NEXUS_PORT: '0', NEXUS_CAPABILITIES_JSON: JSON.stringify({process_control: true})});
  const kills = [];
  const exec = async (exe, args) => { if (args[0] === '/pid') kills.push(args); return {code: 0, out: '"Notepad.exe","4242","Console","1","10 K"'}; };
  const server = createServer(cfg, {procsDeps: {platform: 'win32', systemRoot: 'C:\\Windows', exec}});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  let id = 0;
  const call = async (name, args) => (await (await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${cfg.token}`},
    body: JSON.stringify({jsonrpc: '2.0', id: ++id, method: 'tools/call', params: {name, arguments: args}})})).json()).result;
  try {
    const r = (await call('process_action', {pid: 4242, action: 'close'})).structuredContent;
    assert.equal(r.status, 'consent_required'); assert.equal(r.target, 'Notepad (pid 4242)');
    assert.equal(kills.length, 0);
    assert.match((await call('confirm_action', {consentId: r.consentId, decision: 'close_discard', target: 'Notepad (pid 1)'})).content[0].text, /consent_target_mismatch/);
    const c = (await call('confirm_action', {consentId: r.consentId, decision: 'close_discard', target: r.target})).structuredContent;
    assert.equal(c.confirmed, true); assert.equal(c.result.requested, true);
    assert.deepEqual(kills, [['/pid', '4242']]);
    assert.match((await call('confirm_action', {consentId: r.consentId, decision: 'close_discard', target: r.target})).content[0].text, /consent_expired_or_unknown/);
    assert.equal(kills.length, 1);
    const d = (await call('host_diagnostics', {})).structuredContent;
    assert.equal(d.version, '0.4.2'); assert.equal(d.pendingConsents, 0);
    const events = fs.readFileSync(cfg.auditFile, 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(e => e.event || e.tool);
    for (const e of ['consent_required', 'consent_decision', 'confirm_action', 'host_diagnostics']) assert.ok(events.includes(e), e);
  } finally { server.close(); cfg.runtime?.stop(); }
});

test('tunnel log sanitiser removes URLs and IPs', () => {
  const s = sanitize('2026-11-01T17:00:00Z ERR Connection lost to https://abc.trycloudflare.com via 198.41.200.13:7844 and [2606:4700::1]:443');
  assert.ok(!/trycloudflare|198\.41|2606/.test(s), s);
  assert.match(s, /<url>.*<ip>.*<ip>/);
});
