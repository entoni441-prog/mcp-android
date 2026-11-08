import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {runUiaReal} from './gui.mjs';

test('Windows read-only caption diagnostic, no desktop input', {skip:process.platform!=='win32'},async()=>{
  const points=[[1165,177],[1193,175],[1140,175]];
  const summaries=[];
  for(const [x,y] of points){
    try{
      const r=await runUiaReal({mode:'at',x,y,nativeHitTest:true},
        {tmpDir:path.join(os.tmpdir(),'nexus-titlebar-probe-20261108'),timeoutMs:20000});
      const a=r.at||{};
      summaries.push({point:[x,y],process:a.process,uiType:a.controlType,
        element:a.elem?{name:a.elem.name,id:a.elem.id,rect:a.elem.rect,
          isPassword:a.elem.isPassword}:null,
        window:a.window?{pid:a.window.pid,process:a.window.process,
          hwnd:a.window.hwnd,rect:a.window.rect}:null,
        nativeHit:a.nativeHit,nativeMin:a.nativeCaptionMinimize,
        nativeDrag:a.nativeCaptionDrag});
    }catch(e){summaries.push({point:[x,y],error:String(e.message||e),detail:String(e.detail||'').slice(0,150)});}
  }
  console.log('NX_TITLEBAR_READ_ONLY_PROBE '+JSON.stringify(summaries));
});
