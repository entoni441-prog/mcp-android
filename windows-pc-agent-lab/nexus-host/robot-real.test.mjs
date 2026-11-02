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
    // 0.5.0 Live View frame: JPEG with the cursor drawn at the real pointer position
    const jf = path.join(tmp, 'frm.jpg');
    const fr = await d.cmd(`frame 480 60 ${Buffer.from(jf).toString('base64')}`);
    console.log('robot frame', JSON.stringify(fr));
    const jpg = fs.readFileSync(jf);
    assert.deepEqual([...jpg.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.equal(fr.imageW, Math.min(480, info.w));
    assert.equal(fr.cursorX, cx); assert.equal(fr.cursorY, cy);
    await assert.rejects(d.cmd(`frame 480 5 ${Buffer.from(jf).toString('base64')}`), /out_of_range/);
    // 0.5.2 owner 02.11: pointer = where the mouse is (owner-activity guard); caption bar drawn into the Live View frame
    assert.deepEqual(await d.cmd('pointer'), {x: cx, y: cy});
    const plain = fs.statSync(jf).size;
    const capFr = await d.cmd(`frame 480 60 ${Buffer.from(jf).toString('base64')} - ${Buffer.from('NEXUS working | keyboard_action -> Notepad | ok | 1s ago').toString('base64')}`);
    assert.equal(capFr.imageW, fr.imageW);
    const withCap = fs.readFileSync(jf);
    assert.deepEqual([...withCap.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    console.log('frame bytes plain/caption', plain, withCap.length);
    await assert.rejects(d.cmd(`frame 480 60 ${Buffer.from(jf).toString('base64')} - x y`), /invalid_args/);
    // 0.5.2 A-02: redaction masks are painted BEFORE encoding (whole screen masked → one sampled colour)
    const mc = await d.cmd(`capture 640 ${Buffer.from(file).toString('base64')} ${info.x},${info.y},${info.w},${info.h}`);
    console.log('robot capture masked', JSON.stringify(mc));
    assert.equal(mc.masked, 1); assert.equal(mc.colours, 1);
    const mf = await d.cmd(`frame 480 60 ${Buffer.from(jf).toString('base64')} ${info.x - 10},${info.y - 10},20,20;-`.replace(';-', ''));
    assert.equal(mf.masked, 1);
    assert.equal((await d.cmd(`capture 640 ${Buffer.from(file).toString('base64')} -`)).masked, 0);
    await assert.rejects(d.cmd(`capture 640 ${Buffer.from(file).toString('base64')} 1,2,3`), /invalid_mask/);
    await assert.rejects(d.cmd(`capture 640 ${Buffer.from(file).toString('base64')} ${Array(33).fill('0,0,1,1').join(';')}`), /too_many_masks/);
    // 0.5.2 clipboard: paste reports what happened to the previous clipboard; nothing is silently lost
    const ps = await d.cmd('paste ' + Buffer.from('nexus-clip-test').toString('base64'));
    console.log('robot paste', JSON.stringify(ps));
    assert.match(ps.clipboard, /^(cleared|restored_(text|image|files|mixed)|not_restored_unreadable)$/);
    assert.equal(ps.clipboardRestored, ps.clipboard !== 'not_restored_unreadable');
    // helper keeps serving after errors
    assert.equal((await d.cmd('info')).w, info.w);
  } finally { d.stop(); }
});
