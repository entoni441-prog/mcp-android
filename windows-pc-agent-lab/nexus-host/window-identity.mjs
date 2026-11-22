// Full snapshot identity, including actual HWND owner (UWP frame hosts differ
// from logical app PID), process creation times and UIA top-level runtime id.
// A native re-check is still needed immediately before each input.
export function windowIdentity(win) {
  if (!win || typeof win !== 'object') return null;
  const hwnd = Number(win.hwnd), pid = Number(win.pid), nativePid = Number(win.nativePid);
  const process = typeof win.process === 'string'
    ? win.process.trim().replace(/\.exe$/i, '').toLowerCase() : '';
  const validPid = n => Number.isSafeInteger(n) && n > 0;
  const validTicks = s => typeof s === 'string' && /^[1-9][0-9]{15,19}$/.test(s);
  if (!validPid(hwnd) || !validPid(pid) || !validPid(nativePid) || !process ||
      !validTicks(win.startTime) || !validTicks(win.nativeStart) ||
      typeof win.windowRid !== 'string' || !/^-?\d+(\.-?\d+)+$/.test(win.windowRid)) return null;
  return {hwnd: String(hwnd), pid, process, nativePid, startTime: win.startTime,
    nativeStart: win.nativeStart, windowRid: win.windowRid};
}
export function sameWindowIdentity(expected, live) {
  const actual = windowIdentity(live);
  return !!expected && !!actual && Object.keys(actual).every(k => actual[k] === expected[k]);
}
export function safeWholeWindow(win, token) {
  const id = windowIdentity(win);
  if (!id || /^(explorer|applicationframehost|system|winlogon|csrss|lsass|services|dwm|sihost|shellhost|securityhealthsystray)$/.test(id.process)) return false;
  const tabs = Array.isArray(win.tabs) ? win.tabs.filter(t => typeof t?.rid === 'string' && t.rid) : [];
  // For non-tabbed windows, a process/runtime id is NOT evidence of creation.
  // Require an explicit unique scratch token and preserve it in future checks.
  return tabs.length > 0 || (typeof token === 'string' && token.length >= 8 &&
    typeof win.name === 'string' && win.name.includes(token));
}
