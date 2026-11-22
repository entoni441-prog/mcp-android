// Synthetic-testable identity guard for NEXUS-owned Windows windows.
// HWND alone is not ownership: Windows can reuse a handle after a window closes.
// PID+process narrows stale ownership; this is NOT a native atomic close guarantee.
export function windowIdentity(win) {
  if (!win || typeof win !== 'object') return null;
  const hwnd = Number(win.hwnd), pid = Number(win.pid);
  const process = typeof win.process === 'string'
    ? win.process.trim().replace(/\.exe$/i, '').toLowerCase() : '';
  if (!Number.isSafeInteger(hwnd) || hwnd <= 0 ||
      !Number.isSafeInteger(pid) || pid <= 0 || !process) return null;
  return {hwnd: String(hwnd), pid, process};
}

export function sameWindowIdentity(expected, live) {
  const actual = windowIdentity(live);
  return !!expected && !!actual && expected.hwnd === actual.hwnd &&
    expected.pid === actual.pid && expected.process === actual.process;
}
