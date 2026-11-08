/** Coordinate mapping for an explicit owner tap on a fresh NEXUS Live frame.
 * This only maps geometry; Host GUI policy remains the sole authority.
 * The caller must reject paused/stale/no-session frames before dispatch.
 */
export function framePointToScreen(clientX, clientY, rect, frame) {
  const nums=[clientX,clientY,rect?.left,rect?.top,rect?.width,rect?.height,frame?.screenW,frame?.screenH,frame?.imageW,frame?.imageH];
  if (!nums.every(n=>Number.isFinite(n)) || rect.width<=0 || rect.height<=0 ||
      frame.screenW<1 || frame.screenH<1 || frame.imageW<1 || frame.imageH<1) return null;
  const u=(clientX-rect.left)/rect.width, v=(clientY-rect.top)/rect.height;
  if (u<0 || v<0 || u>=1 || v>=1) return null;
  return {x:Math.floor(u*frame.screenW),y:Math.floor(v*frame.screenH)};
}

/** Only Host stale_args means the original operation was REFUSED before execution.
 * Never retry unknown outcomes or unsafe other errors.
 */
export function isPreExecutionStale(error) {
  return /(?:^|\b)stale_args:\s*(?:task_resumed|owner_stop_resumed|owner_pause_resumed)/i.test(String(error?.message||error));
}

/** Exactly one retry after a verified pre-execution Host refusal and read-only observation. */
export async function callOnceAfterStale(send,reobserve) {
  try {return await send();}
  catch(e){
    if(!isPreExecutionStale(e)) throw e;
    await reobserve();
    return await send();
  }
}

/** Keep the desktop point under the fingers fixed while pinch scale/pan changes.
 * Coordinates are CSS pixels relative to the untransformed image center.
 * A two-finger gesture never executes a Windows action.
 */
export function anchoredZoomPan(oldScale, oldPanX, oldPanY, newScale, fromX, fromY, toX, toY, centerX, centerY) {
  const values=[oldScale,oldPanX,oldPanY,newScale,fromX,fromY,toX,toY,centerX,centerY];
  if (!values.every(Number.isFinite) || oldScale<=0 || newScale<=0) return null;
  const ratio=newScale/oldScale;
  return {
    panX:toX-centerX-ratio*(fromX-centerX-oldPanX),
    panY:toY-centerY-ratio*(fromY-centerY-oldPanY)
  };
}

/** Pan only inside the visible viewport; do not expose black space at the edge. */
export function clampZoomPan(scale, panX, panY, imgW, imgH, viewW, viewH) {
  if (![scale,panX,panY,imgW,imgH,viewW,viewH].every(Number.isFinite) ||
      scale<1 || imgW<=0 || imgH<=0 || viewW<=0 || viewH<=0) return null;
  const maxX=Math.max(0,(imgW*scale-viewW)/2);
  const maxY=Math.max(0,(imgH*scale-viewH)/2);
  return {panX:maxX===0?0:Math.max(-maxX,Math.min(maxX,panX)),
          panY:maxY===0?0:Math.max(-maxY,Math.min(maxY,panY))};
}

/**
 * Android IME edits are mirrored to the remote caret without replacing an
 * existing Windows document. The local input contains only text entered since
 * the last verified remote field click, NEVER a copy of the Windows document.
 *
 * A suffix edit can be replayed using backspaces + inserted Unicode text.
 * Editing inside the local proxy is refused: its selection is not the Windows
 * document's selection. The user can reposition the real caret by touching it.
 */
export function planImeSuffixEdit(before, after, selectionAtEnd = true) {
  if (typeof before !== 'string' || typeof after !== 'string' ||
      after.length > 2000 || before.length > 2000 || !selectionAtEnd) return null;
  if (before === after) return [];
  let prefix=0;
  while(prefix<before.length && prefix<after.length &&
        before[prefix]===after[prefix])prefix++;
  const remove=before.length-prefix, insert=after.slice(prefix);
  if(remove>80 || insert.length>2000) return null;
  return [
    ...Array.from({length:remove},()=>({keys:'backspace'})),
    ...(insert.length?[{text:insert}]:[])
  ];
}
