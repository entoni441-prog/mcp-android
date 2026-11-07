/**
 * NX-CHAT-OWNER-01: Owner-only consent from the inline ChatGPT Live MCP Apps widget.
 *
 * Invariant: The owner's passphrase NEVER travels via tools/call, model context,
 * tool metadata, widgets' model-visible structuredContent, or NEXUS Host.
 * It is POSTed directly from the owner-operated iframe to the owned Gateway over
 * HTTPS, then hashed and checked by the existing atomic ConsentGuard (same
 * one-time nonce + shared 5-fail lockout used by /live).
 *
 * No ambient OAuth session, no cookies, no implicit approval, and no owner
 * decision before a fresh owner-passphrase reauthentication for THAT request.
 * The worker signs an owner_decide only after nonce consumption and auth success.
 */
const originAllowed = origin => /^https:\/\/[a-z0-9-]+\.web-sandbox\.oaiusercontent\.com$/.test(origin || '');
const isSafeConsentId = x => typeof x === 'string' && /^[a-f0-9]{12}$/.test(x);
const OPTIONS = Object.freeze(['allow', 'cancel', 'close_discard', 'close_save']);
const mkHeaders = origin => ({
  'access-control-allow-origin': origin,
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-nexus-widget',
  'access-control-max-age': '120',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'vary': 'Origin',
});
const response = (origin, status, result) => new Response(JSON.stringify(result), {
  status, headers: {...mkHeaders(origin), 'content-type':'application/json; charset=utf-8'},
});
export const widgetOriginAllowed = originAllowed;
export async function handleWidgetConsent(request, env, {callHost, sha256hex, signDecision}) {
  const origin = request.headers.get('origin') || '';
  // A browser's Origin is tied to its own sandbox; no public no-Origin access.
  if (!originAllowed(origin)) return new Response('Forbidden', {status:403});
  if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:mkHeaders(origin)});
  if (request.method !== 'POST' || request.headers.get('x-nexus-widget') !== '1')
    return response(origin,403,{error:'widget_request_required'});
  const path = new URL(request.url).pathname;
  if (path !== '/live/widget/challenge' && path !== '/live/widget/perform')
    return response(origin,404,{error:'not_found'});
  const expected = String(env.OWNER_PASSPHRASE_SHA256 || '').trim().toLowerCase();
  if (!env.CONSENT_GUARD || !/^[a-f0-9]{64}$/.test(expected))
    return response(origin,503,{error:'not_configured'});
  const raw = await request.text();
  if (raw.length > 2048) return response(origin,413,{error:'too_large'});
  let data;try{data=JSON.parse(raw);}catch{return response(origin,400,{error:'invalid_json'});}
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return response(origin,400,{error:'invalid_json'});
  const guard = env.CONSENT_GUARD.get(env.CONSENT_GUARD.idFromName('owner'));
  if (path === '/live/widget/challenge') {
    if (Object.keys(data).some(k=>!['operation','consentId','decision'].includes(k)))
      return response(origin,400,{error:'invalid_args'});
    const operation = data.operation;
    if (!['list','decide'].includes(operation)) return response(origin,400,{error:'invalid_operation'});
    if (operation === 'list' && (data.consentId !== undefined || data.decision !== undefined))
      return response(origin,400,{error:'invalid_args'});
    if (operation === 'decide' &&
        (!isSafeConsentId(data.consentId) || !OPTIONS.includes(data.decision)))
      return response(origin,400,{error:'invalid_args'});
    const nonce = await guard.issue({kind:'widget_owner',origin,operation,
      ...(operation==='decide'?{consentId:data.consentId,decision:data.decision}:{})});
    return response(origin,200,{nonce,expiresInSec:300});
  }
  if (Object.keys(data).some(k=>!['nonce','passphrase'].includes(k)) ||
      typeof data.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(data.nonce) ||
      typeof data.passphrase !== 'string' || data.passphrase.length < 1 || data.passphrase.length > 256)
    return response(origin,400,{error:'invalid_args'});
  // The plaintext NEXUS passphrase is never logged or forwarded to any MCP tool.
  const digest = await sha256hex(data.passphrase);
  const attempt = await guard.attempt({nonce:data.nonce,passphraseSha256:digest,approve:true,expectedSha256:expected});
  if (attempt.status !== 'ok') {
    const status = attempt.status === 'locked' ? 429 : attempt.status === 'invalid' ? 400 : 403;
    return response(origin,status,{error:attempt.status,remaining:attempt.remaining??null});
  }
  const auth=attempt.auth;
  if (auth?.kind !== 'widget_owner' || auth.origin !== origin ||
      !['list','decide'].includes(auth.operation))
    return response(origin,403,{error:'wrong_challenge'});
  if (auth.operation === 'list') {
    const r=await callHost('owner_consents',{});
    if (!r.ok) return response(origin,503,{error:'host_offline'});
    if (r.result?.isError) return response(origin,409,{error:'host_refused'});
    const pending=(r.result?.structuredContent?.pending||[]).filter(x=>
      isSafeConsentId(x.consentId) && x.decided !== true).slice(0,20)
      .map(x=>({consentId:x.consentId,target:String(x.target||'').slice(0,650),
        expiresInSec:Math.max(0,Number(x.expiresInSec)||0),
        options:Array.isArray(x.options)?x.options.filter(o=>OPTIONS.includes(o)):[]}));
    return response(origin,200,{pending});
  }
  if (!isSafeConsentId(auth.consentId) || !OPTIONS.includes(auth.decision))
    return response(origin,403,{error:'wrong_challenge'});
  const ts=Date.now();
  const signature=await signDecision(env,{consentId:auth.consentId,decision:auth.decision,ts});
  const r=await callHost('owner_decide',{consentId:auth.consentId,decision:auth.decision,ts,sig:signature});
  if (!r.ok) return response(origin,503,{error:'host_offline'});
  if (r.result?.isError) return response(origin,409,{error:'host_refused'});
  return response(origin,200,{ok:true,decision:auth.decision});
}
