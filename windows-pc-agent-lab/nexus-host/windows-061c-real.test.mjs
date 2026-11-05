// NEXUS 0.6.1c on a REAL Windows desktop (GitHub windows-latest): install 05.11 C.5 — `taskkill /pid <host> /t /f`
// must NOT take the supervisor with it (and a tree kill of the supervisor must not take the Host).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {pidAlive} from './nexus-supervisor.mjs';

const RUN = process.platform === 'win32' && process.env.NEXUS_REAL_GUI === '1';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const taskkill = (pid, tree) => spawnSync(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/pid', String(pid), ...(tree ? ['/t'] : []), '/f'], {encoding: 'utf8'});

test('real Windows 0.6.1c: a tree kill of the process that started the supervisor leaves the supervisor alive', {skip: !RUN && 'win32 + NEXUS_REAL_GUI=1 only', timeout: 120_000}, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-061c-'));
  // port 1: /healthz never answers; the daemon's first restart attempt comes after ≥55 s — the test ends before that
  // "Host" stand-in: a node process that starts the supervisor exactly like nexus.mjs does, then idles.
  const code = `import(${JSON.stringify('file:///' + path.join(HERE, 'nexus-supervisor.mjs').replace(/\\/g, '/'))}).then(m => { m.ensureSupervisor({home: process.env.H, port: 1}); setInterval(() => {}, 1000); });`;
  const parent = spawn(process.execPath, ['--input-type=module', '-e', code], {cwd: HERE, env: {...process.env, H: home}, stdio: 'ignore'});
  let sup = null;
  for (let i = 0; i < 40 && !sup; i++) { await sleep(500); try { sup = JSON.parse(fs.readFileSync(path.join(home, 'supervisor.pid'), 'utf8')).pid; } catch {} }
  assert.ok(sup, 'supervisor daemon did not start');
  const tree = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${sup}").ParentProcessId`], {encoding: 'utf8'}).stdout.trim();
  console.log('host stand-in', parent.pid, 'supervisor', sup, 'supervisor ParentProcessId', tree);
  assert.notEqual(Number(tree), parent.pid, 'the supervisor must not be a child of the process that started it');
  const k = taskkill(parent.pid, true);
  console.log('taskkill /t', k.stdout.trim());
  await sleep(2000);
  assert.equal(pidAlive(parent.pid), false, 'the stand-in is gone');
  assert.equal(pidAlive(sup), true, 'the supervisor survived the tree kill');
  taskkill(sup, false);
});
