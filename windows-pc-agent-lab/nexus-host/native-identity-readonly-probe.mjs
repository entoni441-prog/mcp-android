// Explicitly read-only acceptance probe. No app launch, focus, input, capture, close, dialog or data modification.
import {runUiaReal} from './gui.mjs';
import {windowIdentity} from './window-identity.mjs';
import {performance} from 'node:perf_hooks';
if(process.platform!=='win32') throw Error('windows_only');
for(const name of ['notepad','CalculatorApp','msedge','explorer']){
  const t=performance.now();
  try {
    const r=await runUiaReal({mode:'apps',name});
    if(!Array.isArray(r.apps)) throw Error('snapshot_missing');
    const wins=r.apps;
    const valid=wins.filter(w=>windowIdentity(w)!==null);
    console.log(JSON.stringify({name,elapsedMs:Math.round(performance.now()-t),count:wins.length,completeIdentity:valid.length,
      hostedFrames:wins.filter(w=>w.frameHost===true).length,
      hostedFramesValid:valid.filter(w=>w.frameHost===true&&w.nativePid!==w.pid).length,
      status:!wins.length?'not_open':valid.length===wins.length?'pass':'identity_incomplete'}));
  }catch(e){console.log(JSON.stringify({name,status:'failed',reason:String(e.message).slice(0,120)}));}
}
