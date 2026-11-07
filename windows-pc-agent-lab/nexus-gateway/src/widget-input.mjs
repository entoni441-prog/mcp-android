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
