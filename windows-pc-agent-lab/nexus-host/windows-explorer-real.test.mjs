// 0.5.2 install 02.11 — inspect_ui on Explorer returned uia_failed («ForEach-Object: method on a null-valued expression»).
// Real Windows: open an Explorer window on a NEXUS-created empty folder, walk its UIA tree (the inspect_ui path), close it.
// Runner Explorer = Windows Server build, not Win11 — the owner's PC remains the final check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {runUiaReal} from './gui.mjs';

const RUN = process.platform === 'win32' && process.env.NEXUS_REAL_GUI === '1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('Windows 0.5.2: UIA tree of a real Explorer window', {skip: !RUN && 'win32 + NEXUS_REAL_GUI=1 only', timeout: 180_000}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-explorer-'));
  for (const n of ['a.txt', 'b.txt']) fs.writeFileSync(path.join(dir, n), 'x');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-uia-'));
  const title = path.basename(dir);
  spawn(path.join(process.env.SystemRoot, 'explorer.exe'), [dir], {detached: true, stdio: 'ignore'}).unref();
  let wins = null;
  try {
    for (let i = 0; i < 30 && !wins?.length; i++) {
      await sleep(1000);
      const r = await runUiaReal({mode: 'apps', name: 'explorer'}, {tmpDir});
      wins = (r.windows || r.apps || []).filter(w => String(w.name || w.title || '').includes(title));
    }
    console.log('explorer windows', JSON.stringify(wins));
    assert.ok(wins?.length, 'Explorer window for the test folder appeared');
    const pid = wins[0].pid;
    let tree;
    try { tree = await runUiaReal({mode: 'tree', pid, depth: 8, max: 400}, {tmpDir, timeoutMs: 60_000}); }
    catch (e) { console.log('uia error detail:', e.detail); throw e; }
    const types = new Set(); const walk = n => { if (!n) return; types.add(n.type); (n.children || []).forEach(walk); };
    (tree.tree || []).forEach(walk);
    console.log('nodes', tree.nodes, 'types', [...types].join(','));
    assert.ok(tree.nodes > 5, 'tree has nodes');
  } finally {
    try { execFileSync('powershell', ['-NoProfile', '-Command', `(New-Object -ComObject Shell.Application).Windows() | ? { $_.LocationURL -like '*${title}*' } | % { $_.Quit() }`], {stdio: 'ignore', timeout: 20_000}); } catch { /* best effort */ }
    fs.rmSync(dir, {recursive: true, force: true}); fs.rmSync(tmpDir, {recursive: true, force: true});
  }
});
