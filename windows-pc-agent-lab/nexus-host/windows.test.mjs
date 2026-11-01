import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {listWindows, buildScript, parseOutput, validateListWindows} from './windows.mjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-win-'));
// Fake PowerShell: records the script and writes what Windows PowerShell 5.1 would (UTF-8 with BOM).
const fakePs = (payload, calls = []) => async (script, {outFile}) => { calls.push(script); fs.writeFileSync(outFile, '\uFEFF' + payload, 'utf8'); };

test('argument validation: only optional boolean includeTitles', () => {
  assert.equal(validateListWindows({}), false);
  assert.equal(validateListWindows({includeTitles: true}), true);
  for (const bad of [null, [], {includeTitles: 'yes'}, {cmd: 'x'}, {includeTitles: true, extra: 1}]) assert.throws(() => validateListWindows(bad), /invalid_args/);
});

test('script is fixed: no title field unless requested, path quoted, no request data inside', () => {
  const s1 = buildScript("C:\\Users\\O'Brien\\.nexus-host\\tmp\\w.json", false);
  assert.match(s1, /Select-Object Id,ProcessName\)/);
  assert.ok(!s1.includes('MainWindowTitle,') && !/Select-Object [^)]*MainWindowTitle/.test(s1));
  assert.ok(s1.includes("'C:\\Users\\O''Brien\\.nexus-host\\tmp\\w.json'"));
  assert.match(buildScript('C:\\t\\w.json', true), /Select-Object Id,ProcessName,MainWindowTitle\)/);
  // CLM-safe: no type accelerators / .NET static calls / Add-Type.
  for (const s of [s1, buildScript('C:\\t\\w.json', true)]) assert.ok(!/\[[A-Za-z.]+\]::|Add-Type|Invoke-Expression|iex /.test(s), s);
});

test('parseOutput: BOM, single object, empty, Cyrillic, truncation', () => {
  assert.deepEqual(parseOutput('\uFEFF[]', false), []);
  assert.deepEqual(parseOutput('', false), []);
  assert.deepEqual(parseOutput('{"Id":7,"ProcessName":"notepad","MainWindowTitle":"x"}', false), [{pid: 7, process: 'notepad'}]);
  const t = parseOutput('[{"Id":1,"ProcessName":"notepad","MainWindowTitle":"Заметки — Блокнот"}]', true);
  assert.deepEqual(t, [{pid: 1, process: 'notepad', title: 'Заметки — Блокнот'}]);
  assert.equal(parseOutput(JSON.stringify([{Id: 2, ProcessName: 'a', MainWindowTitle: 'я'.repeat(500)}]), true)[0].title.length, 200);
  assert.throws(() => parseOutput('garbage', false), /powershell_bad_output/);
});

test('listWindows with fake PowerShell: titles hidden by default, temp file removed', async () => {
  const calls = [];
  const payload = JSON.stringify([{Id: 10, ProcessName: 'notepad', MainWindowTitle: 'Секрет.txt — Блокнот'}, {Id: 11, ProcessName: 'ApplicationFrameHost', MainWindowTitle: 'Калькулятор'}]);
  const out = await listWindows({}, {platform: 'win32', tmpDir, systemRoot: 'C:\\Windows', runPowerShell: fakePs(payload, calls)});
  assert.deepEqual(out, {windows: [{pid: 10, process: 'notepad'}, {pid: 11, process: 'ApplicationFrameHost'}], count: 2, truncated: false, titles: false});
  assert.ok(!JSON.stringify(out).includes('Секрет'));
  const withTitles = await listWindows({includeTitles: true}, {platform: 'win32', tmpDir, systemRoot: 'C:\\Windows', runPowerShell: fakePs(payload)});
  assert.equal(withTitles.windows[0].title, 'Секрет.txt — Блокнот');
  assert.deepEqual(fs.readdirSync(tmpDir), []);
  assert.equal(calls.length, 1);
});

test('listWindows: not Windows, PowerShell failure, cap at 100', async () => {
  await assert.rejects(listWindows({}, {platform: 'linux', tmpDir}), /windows_only/);
  await assert.rejects(listWindows({}, {platform: 'win32', tmpDir, runPowerShell: async () => { throw Error('powershell_failed'); }}), /powershell_failed/);
  await assert.rejects(listWindows({}, {platform: 'win32', tmpDir, runPowerShell: async () => {}}), /powershell_no_output/);
  const many = JSON.stringify(Array.from({length: 130}, (_, i) => ({Id: i + 1, ProcessName: 'p' + i, MainWindowTitle: 't'})));
  const out = await listWindows({}, {platform: 'win32', tmpDir, runPowerShell: fakePs(many)});
  assert.equal(out.windows.length, 100); assert.equal(out.count, 130); assert.equal(out.truncated, true);
  assert.deepEqual(fs.readdirSync(tmpDir), []);
});

// Real Windows PowerShell (GitHub windows-latest runner). Opens Notepad so at least one titled window may exist;
// the runner is not the owner's PC and has no Smart App Control — this proves the script, not the home setup.
test('REAL: Windows PowerShell executes the fixed script and returns a valid list', {skip: process.platform !== 'win32' || process.env.NEXUS_REAL_GUI !== '1' ? 'real GUI: launches notepad.exe; run only with NEXUS_REAL_GUI=1' : false}, async () => {
  const np = spawn(path.win32.join(process.env.SystemRoot, 'System32', 'notepad.exe'), [], {detached: true, stdio: 'ignore'});
  await new Promise(r => setTimeout(r, 2500));
  try {
    const plain = await listWindows({}, {tmpDir});
    assert.ok(Array.isArray(plain.windows));
    assert.equal(plain.titles, false);
    for (const w of plain.windows) { assert.ok(Number.isInteger(w.pid)); assert.equal(typeof w.process, 'string'); assert.ok(!('title' in w)); }
    const titled = await listWindows({includeTitles: true}, {tmpDir});
    for (const w of titled.windows) assert.equal(typeof w.title, 'string');
    console.log('REAL_LIST_WINDOWS', JSON.stringify({count: plain.count, processes: plain.windows.map(w => w.process)}));
  } finally { try { np.kill(); } catch {} }
});
