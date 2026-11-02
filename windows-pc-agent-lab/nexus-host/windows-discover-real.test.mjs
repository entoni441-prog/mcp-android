// 0.5.2 N-01 — real Start Menu discovery on a Windows runner (read-only; launches nothing).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscovery} from './discover.mjs';

const RUN = process.platform === 'win32' && process.env.NEXUS_REAL_GUI === '1';
test('Windows 0.5.2: Start Menu discovery returns launchable apps and never shells', {skip: !RUN && 'win32 + NEXUS_REAL_GUI=1 only', timeout: 120_000}, async () => {
  const d = createDiscovery();
  const all = await d.list();
  console.log('discovered', all.length, JSON.stringify(all.slice(0, 15).map(x => [x.app, x.cls])));
  assert.ok(all.length >= 1, 'at least one installed app');
  assert.ok(all.every(x => /^[a-z0-9][a-z0-9_-]{0,39}$/.test(x.app) && /^[a-zA-Z]:\\.+\.exe$/i.test(x.exe)));
  assert.ok(!all.some(x => /\\(cmd|powershell|pwsh|wt|mshta|notepad)\.exe$/i.test(x.exe)), 'no shells / notepad via discovery');
  assert.ok(all.some(x => x.app === all[0].app) && (await d.find(all[0].app))?.exe === all[0].exe);
});
