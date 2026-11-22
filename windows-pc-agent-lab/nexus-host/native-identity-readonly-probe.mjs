// Explicitly read-only acceptance probe. No app launch, focus, input, capture, close or dialog.
// Only aggregate counts, timings and fixed status codes leave the test process.
import {runUiaReal} from './gui.mjs';
import {windowIdentity} from './window-identity.mjs';
import {UIA_SCRIPT} from './uia-script.mjs';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
if(process.platform!=='win32') throw Error('windows_only');
const tmpDir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-id-probe-'));
const start=UIA_SCRIPT.indexOf('function NxNativeIdentity(');
const end=UIA_SCRIPT.indexOf('function NxStart(',start);
if(start<0||end<0)throw Error('native_function_missing');
const nativeFn=UIA_SCRIPT.slice(start,end);
const verify = nativeFn + String.raw`
$ErrorActionPreference='Stop'
$rows=@($env:NEXUS_PROBE_METADATA | ConvertFrom-Json)
$matched=0
$unavailable=0
foreach($row in $rows){
  $id=NxNativeIdentity ([int64]$row.hwnd)
  if($null -eq $id){$unavailable++;continue}
  if([int]$id.nativePid -eq [int]$row.nativePid -and [string]$id.nativeStart -ceq [string]$row.nativeStart){$matched++}
}
@{checked=$rows.Count;matched=$matched;unavailable=$unavailable}|ConvertTo-Json -Compress
`;
try {
  for(const name of ['notepad','CalculatorApp','msedge','explorer']){
    const t=performance.now();
    try {
      const r=await runUiaReal({mode:'apps',name},{tmpDir});
      if(!Array.isArray(r.apps)) throw Error('snapshot_missing');
      const wins=r.apps,valid=wins.map(windowIdentity).filter(Boolean);
      const result={name,elapsedMs:Math.round(performance.now()-t),count:wins.length,completeIdentity:valid.length,hostedFrames:wins.filter(w=>w.frameHost===true).length,
        hostedFramesValid:wins.filter(w=>w.frameHost===true&&windowIdentity(w)&&w.nativePid!==w.pid).length};
      if(!wins.length){console.log(JSON.stringify({...result,status:'not_open'}));continue}
      if(valid.length!==wins.length){console.log(JSON.stringify({...result,status:'identity_incomplete'}));continue}
      const code=Buffer.from(verify,'utf16le').toString('base64');
      const native=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',code],{env:{...process.env,NEXUS_PROBE_METADATA:JSON.stringify(valid.map(({hwnd,nativePid,nativeStart})=>({hwnd,nativePid,nativeStart})))},encoding:'utf8',windowsHide:true,timeout:15000});
      if(native.status!==0||native.error){console.log(JSON.stringify({...result,status:'native_probe_failed'}));continue}
      const n=JSON.parse(native.stdout.replace(/^\uFEFF/,''));
      console.log(JSON.stringify({...result,native:n,status:n.checked===valid.length&&n.matched===valid.length&&n.unavailable===0?'pass':'native_mismatch'}));
    }catch(e){console.log(JSON.stringify({name,status:'failed',reason:String(e.message).slice(0,120)}));}
  }
} finally {fs.rmSync(tmpDir,{recursive:true,force:true});}
