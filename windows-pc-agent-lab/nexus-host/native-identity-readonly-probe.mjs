// Read-only acceptance probe using the exact guard shared by UIA close/dialog.
// No launch, focus, capture, input or mutation. Output is aggregate metadata only.
import {runUiaReal} from './gui.mjs';
import {windowIdentity} from './window-identity.mjs';
import {performance} from 'node:perf_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function checkWindows(name, uia) {
  const started=performance.now();
  const r=await uia({mode:'apps',name});
  if(!Array.isArray(r.apps)) throw Error('snapshot_missing');
  const wins=r.apps, ids=wins.map(windowIdentity);
  const result={name,snapshotMs:Math.round(performance.now()-started),count:wins.length,
    completeIdentity:ids.filter(Boolean).length,hostedFrames:wins.filter(w=>w.frameHost===true).length};
  if(!wins.length) return {...result,status:'not_open'};
  if(ids.some(id=>!id)) return {...result,status:'identity_incomplete'};
  let checked=0, matched=0, hostedFramesValid=0;
  for(const [i,id] of ids.entries()){
    const reply=await uia({mode:'identity_check',hwnd:Number(id.hwnd),identity:id});
    checked++;
    const c=reply?.identityCheck;
    if(c?.available!==true||c?.same!==true) {
      const reasons=['window_or_identity_unavailable','hwnd_mismatch','native_identity_unavailable','logical_identity_unavailable','identity_mismatch','identity_check_failed'];
      return {...result,checked,matched,hostedFramesValid,status:c?.available===true?'native_mismatch':'native_unavailable',reason:reasons.includes(c?.reason)?c.reason:'invalid_check_reply'};
    }
    matched++;
    if(wins[i].frameHost===true&&id.nativePid!==id.pid) hostedFramesValid++;
  }
  return {...result,checked,matched,hostedFramesValid,elapsedMs:Math.round(performance.now()-started),status:'pass'};
}
async function main(){
  if(process.platform!=='win32')throw Error('windows_only');
  const tmpDir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-id-probe-'));
  try{
    let checked=0;
    for(const name of ['msedge','explorer','CalculatorApp','notepad']){
      try{
        const result=await checkWindows(name,args=>runUiaReal(args,{tmpDir}));
        console.log(JSON.stringify(result));
        checked+=result.matched||0;
        if(!['pass','not_open'].includes(result.status)){process.exitCode=1;break;}
      }catch(e){
        console.log(JSON.stringify({name,status:'failed',reason:String(e.message).slice(0,100)}));process.exitCode=1;break;
      }
    }
    if(checked===0)process.exitCode=1;
  }finally{fs.rmSync(tmpDir,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
