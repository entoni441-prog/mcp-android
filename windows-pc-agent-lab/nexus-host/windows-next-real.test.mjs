// NEXUS NEXT on a REAL Windows desktop (GitHub windows-latest): fixed diagnostics queries return real data, the
// command runner spawns real programs without a shell and kills a process tree, Authenticode + Mark of the Web on NTFS.
// Not the owner's PC: proves the mechanisms, not the owner's hardware (Wake-on-LAN, logon channel stay NOT TESTED).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createDiag, TOPICS} from './diag.mjs';
import {createRunner} from './runner.mjs';
import {createScoped} from './scoped.mjs';
import {validateCapabilities} from './capabilities.mjs';

const real = process.platform === 'win32' && process.env.NEXUS_REAL_GUI === '1';

test('real Windows: every system_info topic answers with parseable data', {skip: !real && 'not a real Windows run', timeout: 600_000}, async () => {
  const d = createDiag({caps: {diagnostics: true}});
  for (const topic of Object.keys(TOPICS)) {
    const t0 = Date.now();
    const r = await d.system_info({topic, limit: 5});
    console.log(topic, Date.now() - t0, 'ms', JSON.stringify(r.data).slice(0, 160));
    assert.equal(r.topic, topic); assert.ok(r.data !== null && r.data !== undefined, topic); assert.ok(!r.data?.unparsed, topic + ' JSON');
  }
  const os_ = await d.system_info({topic: 'os'}); assert.match(String(os_.data.caption), /Windows/);
  const net = await d.system_info({topic: 'network'}); assert.ok(Array.isArray(net.data.adapters));
  const pw = await d.system_info({topic: 'power'}); assert.ok(pw.data.sleepStates.length > 0);
});

test('real Windows: runner — R0 real program, argument literal (no cmd.exe), STOP kills the process tree', {skip: !real && 'not a real Windows run', timeout: 120_000}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-run-')), ws = path.join(home, 'ws'); fs.mkdirSync(ws);
  const r = createRunner({caps: validateCapabilities({commands: true}), cfg: {home, workspace: ws}});
  const w = await r.run_command({exe: 'where', args: ['node']});
  assert.equal(w.exitCode, 0); assert.match(w.stdout, /node\.exe/i);
  fs.writeFileSync(path.join(ws, 'echo.mjs'), 'console.log(process.argv[2])');
  const e = await r.run_command({exe: 'node', args: ['echo.mjs', 'a & calc.exe | x']});
  assert.equal(e.stdout.trim(), 'a & calc.exe | x', 'metacharacters stay literal');
  fs.writeFileSync(path.join(ws, 'parent.mjs'), "import {spawn} from 'node:child_process'; spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], {stdio: 'ignore'}); setTimeout(() => {}, 60000);");
  const p = await r.run_command({exe: 'node', args: ['parent.mjs'], waitSec: 2});
  assert.equal(p.state, 'running');
  const c = await r.cancelAll('owner_stop');
  assert.deepEqual(c.cancelled, [p.id]);
  const st = await r.run_command({action: 'status', id: p.id, waitSec: 5});
  assert.equal(st.state, 'cancelled');
});

test('real Windows: download_verify keeps Mark of the Web on NTFS and checks Authenticode of a signed exe', {skip: !real && 'not a real Windows run', timeout: 120_000}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-dl-')), ws = path.join(home, 'ws'); fs.mkdirSync(ws);
  const exe = fs.readFileSync(process.execPath); // node.exe, signed by the OpenJS Foundation
  const s = createScoped({caps: validateCapabilities({commands: true}), cfg: {home, workspace: ws}, lookup: async () => [{address: '93.184.216.34'}],
    fetchFn: async () => new Response(exe, {status: 200})});
  const r = await s.download_verify({url: 'https://nodejs.org/dist/node.exe', expectedSigner: 'OpenJS', maxMB: 300}); // node.exe > default 50 MB cap
  console.log(JSON.stringify(r.states), JSON.stringify(r.signature));
  assert.ok(r.states.some(x => x.state === 'mark_of_the_web_set'));
  assert.match(fs.readFileSync(path.join(ws, r.file) + ':Zone.Identifier', 'utf8'), /ZoneId=3/);
  assert.equal(r.signature.status, 'Valid'); assert.ok(r.states.some(x => x.state === 'signature_verified'));
});
