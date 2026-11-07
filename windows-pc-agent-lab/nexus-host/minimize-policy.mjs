/** Pure, fail-closed policy for non-destructive top-level window minimization.
 * This is intentionally distinct from mouse / keyboard appGate. A minimization
 * never sends user input to terminal, admin or other app content.
 */
export const SECURE_WINDOW_PROCESSES=new Set([
  'consent','logonui','winlogon','credentialuibroker','lsass','system','dwm'
]);
export function allowedWindowProcess(name){
  const n=String(name||'').replace(/\.exe$/i,'').trim().toLowerCase();
  return !!n && !SECURE_WINDOW_PROCESSES.has(n);
}
const MINIMIZE_NAME=/^(?:minimi[sz]e|minimizar|minimizza|minimieren|riduci a icona|свернуть|згорнути|最小化)(?:\s+(?:window|окно|finestra))?$/iu;
const MINIMIZE_ID=/^(?:minimize|minbutton|minimizebutton|btnminimize|windowminimizebutton)$/i;
const validRect=r=>r&&Number.isFinite(Number(r.x))&&Number.isFinite(Number(r.y))&&
  Number.isFinite(Number(r.w))&&Number.isFinite(Number(r.h))&&
  r.w>0&&r.h>0;
export function isTitlebarMinimizeTouch(at,action){
  if(action!=='click'||!at||!allowedWindowProcess(at.window?.process)||!Number.isSafeInteger(Number(at.window?.pid))||
    !Number.isSafeInteger(Number(at.window?.hwnd))||Number(at.window.hwnd)<=0) return false;
  const el=at.elem||{},win=at.window;
  if(at.controlType!=='ControlType.Button'||el.isPassword!==false)return false;
  if(!MINIMIZE_NAME.test(String(el.name||'').trim())&&!MINIMIZE_ID.test(String(el.id||'').trim()))return false;
  if(!validRect(el.rect)||!validRect(win.rect)||el.rect.w>120||el.rect.h>75)return false;
  const midX=el.rect.x+el.rect.w/2,midY=el.rect.y+el.rect.h/2;
  const top=win.rect.y+Math.min(90,win.rect.h*0.19);
  return midX>=win.rect.x&&midX<=win.rect.x+win.rect.w&&
    midY>=win.rect.y&&midY<=top;
}
