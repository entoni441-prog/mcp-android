// REAL Java Robot (JDK 17 source mode) — runs only with NEXUS_REAL_GUI=1 and a desktop (Windows runner / xvfb).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {RobotDaemon, findJava} from './gui.mjs';

const REAL = process.env.NEXUS_REAL_GUI === '1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-robot-'));

test('NexusRobot.java: info, capture, input, defence-in-depth validation', {skip: !REAL && 'set NEXUS_REAL_GUI=1'}, async () => {
  const d = new RobotDaemon({javaPath: findJava(null)});
  try {
    const info = await d.cmd('info');
    console.log('robot info', JSON.stringify(info));
    assert.ok(info.w > 0 && info.h > 0 && info.screens >= 1);
    const file = path.join(tmp, 'cap.png');
    const cap = await d.cmd(`capture 640 ${Buffer.from(file).toString('base64')}`);
    console.log('robot capture', JSON.stringify(cap));
    const png = fs.readFileSync(file);
    assert.deepEqual([...png.subarray(0, 4)], [137, 80, 78, 71]);
    assert.equal(png.readUInt32BE(16), Math.min(640, info.w));
    assert.equal(cap.imageW, Math.min(640, info.w));
    const cx = info.x + Math.floor(info.w / 2), cy = info.y + Math.floor(info.h / 2);
    assert.deepEqual(await d.cmd(`move ${cx} ${cy}`), {moved: true});
    assert.deepEqual(await d.cmd('key shift'), {pressed: true});
    await assert.rejects(d.cmd(`move ${info.x + info.w + 50} ${cy}`), /out_of_screen/);
    for (const k of ['win', 'meta', 'windows', 'ctrl+win+r', 'f13']) await assert.rejects(d.cmd('key ' + k), /invalid_key/, k);
    await assert.rejects(d.cmd('click 1 1 left 3'), /out_of_range/);
    await assert.rejects(d.cmd('exec calc'), /unknown_command/);
    await assert.rejects(d.cmd('move 1 1\nexec x'), /invalid_args/);
    // helper keeps serving after errors
    assert.equal((await d.cmd('info')).w, info.w);
  } finally { d.stop(); }
});
