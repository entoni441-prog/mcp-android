// NEXUS NEXT block 4: files outside the workspace (scope/consent/protected/backup/atomic), download_verify (states,
// private hops, hash quarantine), power model (dry run, blockers, consent, BLOCKED wake), Sentinel, autostart templates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createScoped} from './scoped.mjs';
import {createPower} from './power.mjs';
import {createConsent} from './consent.mjs';
import {validateCapabilities} from './capabilities.mjs';
import {classifyLogonState, activeFromQuser} from './sentinel/nexus-sentinel.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-next-b4-'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const allow = async (consent, r) => { assert.equal(r.status, 'consent_required', JSON.stringify(r).slice(0, 200)); const p = consent.take(r.consentId, 'allow', r.target); return p.apply(); };

test('files_scoped: task root autonomous; outside → consent; protected → consent+redaction; executor → consent with diff', async () => {
  const root = fs.mkdtempSync(path.join(tmp, 'proj-')), outside = fs.mkdtempSync(path.join(tmp, 'other-'));
  const home = fs.mkdtempSync(path.join(tmp, 'home-'));
  const caps = validateCapabilities({taskRoots: [root]});
  const consent = createConsent({});
  const s = createScoped({caps, cfg: {home, workspace: path.join(home, 'ws')}, consent});
  fs.writeFileSync(path.join(root, 'a.txt'), 'hello');
  fs.mkdirSync(path.join(root, '.ssh')); fs.writeFileSync(path.join(root, '.ssh', 'id_rsa'), 'x'); fs.writeFileSync(path.join(root, '.env'), 'API_KEY=sk-' + 'a'.repeat(40));
  const ls = await s.files_scoped({action: 'list', path: root});
  assert.deepEqual(ls.entries.map(e => e.name).sort(), ['a.txt']); assert.equal(ls.protectedHidden, 2);
  const rd = await s.files_scoped({action: 'read', path: path.join(root, 'a.txt')});
  assert.equal(rd.text, 'hello'); assert.equal(rd.sha256, sha('hello'));
  const env = await s.files_scoped({action: 'read', path: path.join(root, '.env')});
  assert.equal(env.what, 'protected_file');
  const envRead = await allow(consent, env); assert.doesNotMatch(envRead.text, /sk-a{40}/, 'protected content redacted even after consent');
  fs.writeFileSync(path.join(outside, 'b.txt'), 'b');
  const out = await s.files_scoped({action: 'read', path: path.join(outside, 'b.txt')});
  assert.equal(out.what, 'file_outside_scope'); assert.equal((await allow(consent, out)).text, 'b');
  const ex = await s.files_scoped({action: 'write', path: path.join(root, 'package.json'), content: '{"scripts":{"x":"y"}}', expectedSha256: null});
  assert.equal(ex.what, 'executor_file_write');
  await assert.rejects(s.files_scoped({action: 'read', path: root + '/../etc/passwd'}), /invalid_args/);
  await assert.rejects(s.files_scoped({action: 'read', path: 'relative.txt'}), /invalid_args/);
});

test('files_scoped: create / replace-with-backup (sha check, atomic) / edit-copy / copy never overwrites / delete to trash', async () => {
  const root = fs.mkdtempSync(path.join(tmp, 'proj-')), home = fs.mkdtempSync(path.join(tmp, 'home-'));
  const s = createScoped({caps: validateCapabilities({taskRoots: [root]}), cfg: {home, workspace: path.join(home, 'ws')}, consent: createConsent({})});
  const f = path.join(root, 'doc.txt');
  const c = await s.files_scoped({action: 'write', path: f, content: 'v1', expectedSha256: null});
  assert.equal(c.created, true);
  await assert.rejects(s.files_scoped({action: 'write', path: f, content: 'v2', expectedSha256: null}), /expected_sha256_mismatch|EEXIST/);
  await assert.rejects(s.files_scoped({action: 'write', path: f, content: 'v2', expectedSha256: 'a'.repeat(64)}), /expected_sha256_mismatch/);
  assert.equal(fs.readFileSync(f, 'utf8'), 'v1', 'conflict wrote nothing');
  const r = await s.files_scoped({action: 'write', path: f, content: 'v2', expectedSha256: sha('v1')});
  assert.equal(fs.readFileSync(f, 'utf8'), 'v2'); assert.equal(fs.readFileSync(r.backup, 'utf8'), 'v1'); assert.equal(r.previousSha256, sha('v1'));
  assert.deepEqual(fs.readdirSync(root).filter(n => n.includes('nexus-tmp')), [], 'no temp leftovers');
  const ec = await s.files_scoped({action: 'write', path: f, content: 'draft', mode: 'edit-copy'});
  assert.equal(fs.readFileSync(f, 'utf8'), 'v2'); assert.equal(fs.readFileSync(ec.path, 'utf8'), 'draft');
  await assert.rejects(s.files_scoped({action: 'copy', path: ec.path, to: f}), /EEXIST/);
  const d = await s.files_scoped({action: 'delete', path: ec.path});
  assert.equal(fs.existsSync(ec.path), false); assert.equal(fs.readFileSync(d.movedTo, 'utf8'), 'draft'); assert.match(d.movedTo, /\.nexus-trash/);
});

function fakeFetch(routes) {
  return async url => {
    const r = routes[url]; if (!r) return new Response('nf', {status: 404});
    if (r.redirect) return new Response(null, {status: 302, headers: {location: r.redirect}});
    return new Response(r.body, {status: 200});
  };
}
test('download_verify: states, hash verified, mismatch quarantined, private redirect hop refused, https only, MOTW on Windows', async () => {
  const home = fs.mkdtempSync(path.join(tmp, 'home-')), ws = path.join(home, 'ws'); fs.mkdirSync(ws);
  const body = Buffer.from('PK fake zip content');
  const lookup = async h => (h.endsWith('.internal-test') ? [{address: '10.0.0.5'}] : [{address: '93.184.216.34'}]);
  const s = createScoped({caps: validateCapabilities({commands: true}), cfg: {home, workspace: ws}, lookup, platform: 'linux',
    fetchFn: fakeFetch({'https://dl.example.com/a.zip': {body}, 'https://dl.example.com/r': {redirect: 'https://evil.internal-test/x'}, 'https://dl.example.com/b.zip': {body}})});
  const ok = await s.download_verify({url: 'https://dl.example.com/a.zip', sha256: sha(body)});
  assert.equal(ok.downloaded, true); assert.equal(ok.verified, true);
  assert.deepEqual(ok.states.map(x => x.state), ['download_requested', 'download_started', 'download_completed', 'hash_verified']);
  assert.equal(fs.readFileSync(path.join(ws, ok.file)).toString(), body.toString());
  const bad = await s.download_verify({url: 'https://dl.example.com/b.zip', sha256: 'f'.repeat(64)});
  assert.equal(bad.verified, false); assert.ok(bad.states.some(x => x.state === 'hash_mismatch')); assert.match(bad.file, /\.quarantine/);
  const priv = await s.download_verify({url: 'https://dl.example.com/r'});
  assert.equal(priv.downloaded, false); assert.equal(priv.states.at(-1).state, 'download_refused');
  await assert.rejects(s.download_verify({url: 'http://dl.example.com/a.zip'}), /url_not_allowed/);
  await assert.rejects(s.download_verify({url: 'https://127.0.0.1/a.zip'}), /url_not_allowed/);
  // Windows: Mark of the Web written as Zone.Identifier (simulated path on Linux: an extra file with the stream name).
  const w = createScoped({caps: validateCapabilities({commands: true}), cfg: {home, workspace: ws}, lookup, platform: 'win32', sigCheck: async () => ({status: 'Valid', signer: 'CN=Microsoft Corporation'}),
    fetchFn: fakeFetch({'https://dl.example.com/tool.exe': {body}})});
  const e = await w.download_verify({url: 'https://dl.example.com/tool.exe', expectedSigner: 'Microsoft'});
  assert.ok(e.states.some(x => x.state === 'mark_of_the_web_set')); assert.ok(e.states.some(x => x.state === 'signature_verified'));
  assert.match(fs.readFileSync(path.join(ws, e.file) + ':Zone.Identifier', 'utf8'), /ZoneId=3/);
  await assert.rejects(createScoped({caps: validateCapabilities({commands: false}), cfg: {home, workspace: ws}}).download_verify({url: 'https://dl.example.com/a.zip'}), /capability_disabled/);
});

test('power_action: dry run by default; blockers; lock immediate; wake BLOCKED; consent only when preconditions hold', async () => {
  const calls = []; const exec = async (exe, args) => { calls.push([path.win32.basename(exe), ...args]); return {code: 0}; };
  const consent = createConsent({});
  let f = {autostartVerified: false, logonChannelVerified: false, wakeDevice: null, unsavedOwnerDocs: ['Notepad'], sleepStates: ['Standby (S3)']};
  let locked = 0;
  const p = createPower({caps: validateCapabilities({power: true}), consent, platform: 'win32', exec, facts: async () => f, onLock: () => locked++});
  const dry = await p.power_action({action: 'restart'});
  assert.equal(dry.dryRun, true); assert.deepEqual(dry.blockers.sort(), ['autostartVerified', 'logonChannelVerified', 'noUnsavedOwnerDocuments']);
  assert.equal((await p.power_action({action: 'restart', dryRun: false})).status, 'BLOCKED'); assert.equal(calls.length, 0);
  assert.equal((await p.power_action({action: 'sleep', dryRun: false})).blockers.includes('independentWakeDevice'), true);
  assert.equal((await p.power_action({action: 'wake'})).status, 'BLOCKED');
  assert.equal((await p.power_action({action: 'lock'})).accepted, true); assert.equal(locked, 1); assert.deepEqual(calls[0], ['rundll32.exe', 'user32.dll,LockWorkStation']);
  f = {...f, autostartVerified: true, logonChannelVerified: true, unsavedOwnerDocs: []};
  const c = await p.power_action({action: 'restart', dryRun: false});
  assert.equal(c.status, 'consent_required'); assert.equal(calls.length, 1, 'nothing runs before consent');
  const done = await allow(consent, c);
  assert.equal(done.accepted, true); assert.deepEqual(calls[1].slice(0, 4), ['shutdown.exe', '/r', '/t', '60']); assert.ok(!calls[1].includes('/f'), 'never forced');
  await assert.rejects(createPower({caps: validateCapabilities({power: false}), platform: 'win32', exec}).power_action({action: 'lock'}), /capability_disabled/);
});

test('Sentinel: state classification and quser parsing; no input/screen/command code in the file', () => {
  assert.equal(classifyLogonState({uptimeSec: 60}), 'booting');
  assert.equal(classifyLogonState({uptimeSec: 900, logonUi: true}), 'logon_screen');
  assert.equal(classifyLogonState({logonUi: true, activeSession: true}), 'locked');
  assert.equal(classifyLogonState({activeSession: true}), 'user_session');
  assert.equal(classifyLogonState({activeSession: true, hostUp: true}), 'host_up');
  assert.equal(activeFromQuser(' USERNAME SESSIONNAME ID STATE\n>owner console 1 Active none 03.11'), true);
  assert.equal(activeFromQuser(' USERNAME SESSIONNAME ID STATE\n owner  2 Disc .'), false);
  const src = fs.readFileSync(new URL('./sentinel/nexus-sentinel.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /keybd|SendInput|mouse|screenshot|CopyFromScreen|Robot|powershell|spawn\(|password|AutoAdminLogon/i);
});

test('autostart templates: logon trigger for the owner (no autologon), Sentinel at boot as SYSTEM, single instance', () => {
  const host = fs.readFileSync(new URL('./install/NEXUS-Host-Logon.xml', import.meta.url), 'utf8');
  const sen = fs.readFileSync(new URL('./install/NEXUS-Sentinel.xml', import.meta.url), 'utf8');
  assert.match(host, /<LogonTrigger>/); assert.match(host, /InteractiveToken/); assert.match(host, /LeastPrivilege/); assert.match(host, /IgnoreNew/);
  assert.match(sen, /<BootTrigger>/); assert.match(sen, /S-1-5-18/); assert.match(sen, /IgnoreNew/);
  for (const x of [host, sen]) { assert.doesNotMatch(x, /AutoAdminLogon|DefaultPassword|<Password>|HighestAvailable/i); assert.match(x, /__NODE__/); }
});
