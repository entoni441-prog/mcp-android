// Synthetic UIA snapshot identity; never imported by production modules.
export function fixtureIdentity(w) {
  const startTime = String(w.startTime ?? (638000000000000000n + BigInt(w.pid) * 100000n));
  return {...w, startTime, nativePid: w.nativePid ?? w.pid,
    nativeStart: w.nativeStart ?? startTime, windowRid: w.windowRid ?? ('42.' + w.hwnd)};
}
