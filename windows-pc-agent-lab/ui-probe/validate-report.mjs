/** Strict, offline validation of one locally-consented Windows UI Automation report.
 * No network, filesystem access, remote invocation or control commands.
 * Reject unknown keys and sensitive text rather than silently forwarding it.
 */
const MAX_BYTES = 16 * 1024;
const MAX_CONTROLS = 40;
const allowedApps = new Set(['notepad', 'calculator']);
const expectedReasons = Object.freeze({
  ok: new Set(['inspection_completed']),
  blocked: new Set([
    'explicit_local_consent_required', 'interactive_user_session_required',
    'no_foreground_window', 'foreground_uia_unavailable',
    'foreground_identity_unknown', 'foreground_app_not_allowlisted',
    'foreground_element_is_not_window'
  ]),
  error: new Set(['uia_unavailable_or_access_denied'])
});
const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function exactKeys(record, required) {
  return isRecord(record) &&
    Object.keys(record).length === required.length &&
    required.every(k => Object.hasOwn(record, k));
}
function requireValid(valid) {
  if (!valid) throw Error('invalid_uia_report');
}
const rootKeys = ['status','reason','mode','app','metadata'];
const metaKeys = ['observedControls','truncated','controls'];
const controlKeys = ['controlType','automationId','isEnabled'];

/** Returns an allowlisted summary; not a copy of arbitrary untrusted JSON. */
export function validateUiReport(serialized) {
  requireValid(typeof serialized === 'string' &&
    Buffer.byteLength(serialized, 'utf8') <= MAX_BYTES);
  let input;
  try {
    input = JSON.parse(serialized);
  } catch {
    throw Error('invalid_uia_report');
  }
  requireValid(exactKeys(input,rootKeys) &&
    allowedApps.has(input.app) &&
    input.mode === 'local_read_only' &&
    Object.hasOwn(expectedReasons,input.status) &&
    expectedReasons[input.status].has(input.reason));
  if (input.status !== 'ok') {
    requireValid(input.metadata === null);
    return Object.freeze({
      status: input.status, reason: input.reason,
      mode: 'local_read_only', app: input.app, metadata: null
    });
  }
  const m = input.metadata;
  requireValid(exactKeys(m,metaKeys) &&
    Number.isSafeInteger(m.observedControls) &&
    m.observedControls >= 0 && m.observedControls <= MAX_CONTROLS &&
    typeof m.truncated === 'boolean' &&
    Array.isArray(m.controls) &&
    m.controls.length === m.observedControls);
  const controls = m.controls.map(c => {
    requireValid(exactKeys(c,controlKeys) &&
      typeof c.controlType === 'string' && c.controlType.length <= 64 &&
      /^ControlType\.[A-Za-z]{2,40}$/.test(c.controlType) &&
      typeof c.automationId === 'string' &&
      c.automationId.length <= 48 &&
      /^[A-Za-z0-9_.-]*$/.test(c.automationId) &&
      typeof c.isEnabled === 'boolean');
    return Object.freeze({
      controlType: c.controlType,
      automationId: c.automationId,
      isEnabled: c.isEnabled
    });
  });
  return Object.freeze({
    status: 'ok', reason: 'inspection_completed',
    mode: 'local_read_only', app: input.app,
    metadata: Object.freeze({
      observedControls: controls.length,
      truncated: m.truncated,
      controls: Object.freeze(controls)
    })
  });
}
