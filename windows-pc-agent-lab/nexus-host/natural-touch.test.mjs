import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {UIA_SCRIPT} from './uia-script.mjs';
import {createLive} from './live.mjs';

test('native caption proof requires exact minimize index, ownership and never sends input',()=>{
  assert.match(UIA_SCRIPT,/rects\[2\]/);
  assert.match(UIA_SCRIPT,/actualPid|realPid/);
  assert.match(UIA_SCRIPT,/IsWindowVisible/);
  assert.match(UIA_SCRIPT,/0x0084/);
  assert.match(UIA_SCRIPT,/ToUInt64\(\) == 8/);
  assert.doesNotMatch(UIA_SCRIPT,/PostMessage|WM_CLOSE/);
});

test('Windows: native caption proof compiles and rejects a synthetic non-window', {skip:process.platform!=='win32'},()=>{
  const temp=mkdtempSync(path.join(os.tmpdir(),'nexus-caption-'));
  try{
    const out=path.join(temp,'uia.json');
    const script=UIA_SCRIPT+"\n$null = NxCaptionMinimizeAt @{ok=$true;hwnd=1;pid=1} 50 50; if(-not ('NxCaption.Proof' -as [type])) { throw 'native_caption_compile_failed' }";
    const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{
      env:{...process.env,NEXUS_UIA_ARGS:JSON.stringify({mode:'focused'}),NEXUS_UIA_OUT:out},
      encoding:'utf8',timeout:25000
    });
    assert.equal(r.status,0,(r.stderr||'').slice(-2000));
    assert.equal(JSON.parse(readFileSync(out,'utf8').replace(/^\\uFEFF/,'')).mode,'focused');
  }finally{rmSync(temp,{recursive:true,force:true});}
});

test('owner Live sees plain Notepad without a second password, model cache stays masked',async()=>{
  const calls=[];
  const meta={imageW:960,imageH:540,screenW:1280,screenH:720,cursorX:0,cursorY:0};
  const live=createLive({caps:{live_view:true},store:{set:()=>{}},indicator:()=>{},
    setIntervalFn:()=>null,
    capture:async()=>{calls.push('redacted');return {jpeg:Buffer.from('MASKED'),meta};},
    ownerCapture:async()=>{calls.push('owner-widget');return {jpeg:Buffer.from('NOTEPAD'),meta};}
  });
  const a=await live.live_frame({});
  assert.equal(Buffer.from(a.content[0].data,'base64').toString(),'NOTEPAD');
  const b=await live.frameBytes();
  assert.equal(b.jpeg.toString(),'MASKED');
  assert.deepEqual(calls,['owner-widget','redacted']);
  live.stop();
});
