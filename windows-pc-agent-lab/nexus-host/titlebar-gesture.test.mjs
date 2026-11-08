import test from 'node:test';
import assert from 'node:assert/strict';
import {createGui} from './gui.mjs';
import {validateCapabilities} from './capabilities.mjs';
import {UIA_SCRIPT} from './uia-script.mjs';
import {isTitlebarMinimizeTouch} from './policy.mjs';

const ROOT={x:0,y:0,w:1280,h:720}, INFO={x:0,y:0,w:1280,h:720,screens:1};
const PROC='WindowsTerminal',PID=444,HWND=66252;
function mock({atOverrides={},moveVerified=true,minimized=true}={}){
  const seen=[],robotOps=[],handoffs=[];
  const at={
    pid:PID,process:PROC,controlType:'ControlType.Pane',
    elem:{name:'TitleBar',id:'',isPassword:false},
    window:{pid:PID,process:PROC,hwnd:HWND,name:'NEXUS Host',
      rect:{x:200,y:100,w:850,h:450}},
    nativeHit:{ok:true,pid:PID,hwnd:HWND},
    nativeCaptionDrag:{verified:true,pid:PID,hwnd:HWND,process:PROC},
    nativeCaptionMinimize:null,...atOverrides
  };
  const runUia=async a=>{
    seen.push(a);
    if(a.mode==='focused')return {root:ROOT,focused:{ok:true,pid:PID,process:PROC}};
    if(a.mode==='at')return {root:ROOT,at};
    if(a.mode==='move_caption')return {root:ROOT,verified:moveVerified,pid:a.pid,
      hwnd:a.hwnd,process:PROC,shellInputSent:false};
    if(a.mode==='minimize')return {root:ROOT,verified:minimized,pid:a.pid,
      hwnd:a.hwnd,process:PROC,isMinimizedAfter:minimized};
    throw Error('unexpected UIA '+a.mode);
  };
  const robot={cmd:async c=>{robotOps.push(c);if(c==='info')return INFO;if(c==='pointer')return null;return {ok:true};},start:async()=>{},stop(){}};
  const gui=createGui({caps:validateCapabilities({gui_input:true}),home:'C:\\Users\\krado',
    workspace:'C:\\Users\\krado\\NEXUS-workspace',platform:'win32',runUia,robot,
    handoff:async spec=>{handoffs.push(spec);return {status:'handoff_requested'};}});
  return {gui,seen,robotOps,handoffs};
}

test('verified native titlebar drag moves one WindowsTerminal window, not mouse or shell',async()=>{
  const x=mock();
  const r=await x.gui.mouse_action({action:'drag',x:550,y:120,x2:700,y2:170});
  assert.deepEqual({done:r.done,action:r.action,pid:r.pid,hwnd:r.hwnd,
    verified:r.verified,shellInputSent:r.shellInputSent},
    {done:true,action:'window_move',pid:PID,hwnd:HWND,verified:true,shellInputSent:false});
  const m=x.seen.filter(a=>a.mode==='move_caption');assert.equal(m.length,1);
  assert.deepEqual({pid:m[0].pid,hwnd:m[0].hwnd,fromX:m[0].fromX,fromY:m[0].fromY,dx:m[0].dx,dy:m[0].dy},
    {pid:PID,hwnd:HWND,fromX:550,fromY:120,dx:150,dy:50});
  assert.ok(!x.robotOps.some(c=>/^(?:drag|click|key|paste)/.test(c)));
  assert.equal(x.handoffs.length,0);
});

test('missing caption or forged HWND refuses movement without sticky owner handoff',async()=>{
  for(const proof of [null,{verified:true,pid:PID,hwnd:99999,process:PROC}]){
    const x=mock({atOverrides:{nativeCaptionDrag:proof}});
    await assert.rejects(x.gui.mouse_action({action:'drag',x:550,y:120,x2:700,y2:170}),
      /terminal_caption_unverified/);
    assert.equal(x.seen.some(a=>a.mode==='move_caption'),false);
    assert.equal(x.robotOps.some(c=>c.startsWith('drag ')),false);
    assert.equal(x.handoffs.length,0);
  }
});

test('native move result unverified aborts, never performs fallback robot drag',async()=>{
  const x=mock({moveVerified:false});
  await assert.rejects(x.gui.mouse_action({action:'drag',x:550,y:120,x2:700,y2:170}),
    /titlebar_move_not_verified/);
  assert.equal(x.robotOps.some(c=>c.startsWith('drag ')),false);
});

test('UIA minimize button of verified top-level window can omit isPassword property',async()=>{
  const at={pid:PID,process:PROC,controlType:'ControlType.Button',
    window:{pid:PID,process:PROC,hwnd:HWND,rect:{x:200,y:100,w:850,h:450}},
    elem:{name:'Minimize',id:'MinimizeButton',rect:{x:900,y:104,w:35,h:32}}};
  assert.equal(isTitlebarMinimizeTouch(at,'click'),true);
  assert.equal(isTitlebarMinimizeTouch({...at,elem:{...at.elem,isPassword:true}},'click'),false);
  const x=mock({atOverrides:at});
  const r=await x.gui.mouse_action({action:'click',x:917,y:119});
  assert.equal(r.action,'minimize');
  assert.equal(r.verified,true);
  assert.equal(x.handoffs.length,0);
  assert.equal(x.robotOps.some(c=>c.startsWith('click ')),false);
});

test('Win32 move requires HTCAPTION and revalidates live HWND/PID',()=>{
  assert.match(UIA_SCRIPT,/hit\.ToUInt64\(\)==2/);
  assert.match(UIA_SCRIPT,/IsMoveCaption\(hwnd,pid,fromX,fromY\)/);
  assert.match(UIA_SCRIPT,/GetWindowThreadProcessId\(h,out pidAfter\)/);
  assert.match(UIA_SCRIPT,/SetWindowPos/);
  assert.match(UIA_SCRIPT,/\$hit=Nx26NativeHit/);
  assert.doesNotMatch(UIA_SCRIPT,/PostMessage|WM_CLOSE/);
});

// v10.1 — Samsung 08.11 audit: click (864,419) in terminal content created shell_command handoff h-ed2c76b294,
// and every later caption tap failed with owner_handoff_active.
test('v10.1: click inside terminal content is refused with NO handoff; later caption minimize still works',async()=>{
  const content={controlType:'ControlType.Text',elem:{name:'',id:'',isPassword:false},nativeCaptionDrag:null,
    window:{pid:PID,process:PROC,hwnd:HWND,name:'NEXUS Host',rect:{x:0,y:0,w:1100,h:600}}};
  const x=mock({atOverrides:content});
  await assert.rejects(x.gui.mouse_action({action:'click',x:864,y:419}),/terminal_content_refused/);
  assert.equal(x.handoffs.length,0);
  assert.equal(x.robotOps.some(c=>/^(?:click|drag|key|paste)/.test(c)),false);
  const y=mock({atOverrides:{nativeCaptionDrag:null,
    nativeCaptionMinimize:{verified:true,pid:PID,hwnd:HWND,process:PROC}}});
  const r=await y.gui.mouse_action({action:'click',x:1062,y:44});
  assert.deepEqual([r.action,r.verified,r.shellInputSent],['minimize',true,false]);
  assert.equal(y.handoffs.length,0);
});
