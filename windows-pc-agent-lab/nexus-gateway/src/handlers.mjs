/**
 * NEXUS Gateway handlers (no npm imports — testable standalone).
 * ChatGPT ──OAuth (workers-oauth-provider)──▶ /mcp ──Bearer NEXUS_TOKEN──▶ quick tunnel ──▶ NEXUS Host on the owner's PC.
 *
 * Secrets (wrangler secret put): NEXUS_TOKEN (same as PC token.txt), OWNER_PASSPHRASE_SHA256 (hex sha256 of owner passphrase).
 * Bindings: OAUTH_KV (KV: OAuth library + tunnel URL), CONSENT_GUARD (Durable Object: atomic lockout + single-use consent).
 * OAUTH_PROVIDER is injected by workers-oauth-provider.
 */
const enc = new TextEncoder();
// `wrangler secret put` fed from a PowerShell pipe may append CR/LF — normalise once.
const secret = v => typeof v === 'string' ? v.trim() : v;
const TUNNEL_RE = /^https:\/\/[a-z0-9-]{3,80}\.trycloudflare\.com$/;

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256hex = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function bearerOk(request, secret) {
  const m = /^Bearer (\S{32,256})$/.exec(request.headers.get('authorization') || '');
  return !!m && typeof secret === 'string' && secret.length >= 32 && timingSafeEqualHex(await sha256hex(m[1]), await sha256hex(secret));
}
const json = (status, body, extra = {}) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store', ...extra}});
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
const page = (title, body, status = 200) => new Response(
  `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>` +
  `<body style="font-family:system-ui;max-width:520px;margin:40px auto;padding:0 16px">${body}</body></html>`, {status, headers: HTML_HEADERS});

/** OAuth defaultHandler: /authorize consent with owner passphrase, /tunnel registration, /health. */
export async function handleDefault(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/health') return json(200, {ok: true, service: 'nexus-gateway'});
  if (url.pathname === '/tunnel') return handleTunnel(request, env);
  if (url.pathname !== '/authorize') return new Response('Not found', {status: 404});
  const expected = secret(env.OWNER_PASSPHRASE_SHA256 || '').toLowerCase();
  if (!env.OAUTH_PROVIDER || !env.CONSENT_GUARD || !/^[a-f0-9]{64}$/.test(expected)) return new Response('Gateway not configured', {status: 503});
  const guard = env.CONSENT_GUARD.get(env.CONSENT_GUARD.idFromName('owner'));

  if (request.method === 'GET') {
    let auth;
    try { auth = await env.OAUTH_PROVIDER.parseAuthRequest(request); } catch { return page('Ошибка', '<p>Некорректный запрос авторизации.</p>', 400); }
    const client = auth?.clientId ? await env.OAUTH_PROVIDER.lookupClient(auth.clientId) : null;
    if (!client) return page('Ошибка', '<p>Неизвестный клиент.</p>', 400);
    const nonce = await guard.issue(auth);
    const name = escapeHtml(client.clientName || client.client_name || 'MCP client');
    return page('NEXUS — доступ к ПК',
      `<h1>Разрешить доступ к Windows-ПК?</h1><p><b>${name}</b> запрашивает управление NEXUS Host на твоём компьютере.</p>` +
      `<p>Подтверди только если подключение начал ты.</p><form method="POST" action="/authorize">` +
      `<input type="hidden" name="nonce" value="${nonce}"><p><label>Пароль владельца<br><input type="password" name="passphrase" autocomplete="current-password" required style="width:100%"></label></p>` +
      `<button type="submit" name="decision" value="approve">Разрешить</button> <button type="submit" name="decision" value="deny">Отклонить</button></form>`);
  }
  if (request.method !== 'POST') return new Response('Method not allowed', {status: 405});

  const form = await request.formData();
  const nonce = String(form.get('nonce') || '');
  if (!/^[a-f0-9]{64}$/.test(nonce)) return page('Ошибка', '<p>Сессия недействительна.</p>', 400);
  // Hash here, outside the Durable Object: the guard call itself only does storage I/O.
  const passphraseSha256 = await sha256hex(String(form.get('passphrase') || ''));
  const r = await guard.attempt({nonce, passphraseSha256, approve: form.get('decision') === 'approve', expectedSha256: expected});
  if (r.status === 'locked') return page('Заблокировано', `<p>Слишком много неверных попыток. Повтори через ${Math.ceil(r.retryAfterMs / 60000)} мин.</p>`, 429);
  if (r.status === 'invalid') return page('Ошибка', '<p>Сессия истекла или уже использована. Начни подключение заново.</p>', 400);
  if (r.status === 'denied') return page('Отклонено', '<p>Доступ не выдан.</p>', 403);
  if (r.status === 'bad_passphrase') return page('Ошибка', `<p>Неверный пароль. Осталось попыток: ${r.remaining}.</p>`, 403);
  if (r.status !== 'ok') return page('Ошибка', '<p>Отказ.</p>', 403);
  const auth = r.auth;
  const {redirectTo} = await env.OAUTH_PROVIDER.completeAuthorization({
    request: auth, userId: 'owner', scope: auth.scope || [], props: {owner: true}, metadata: {label: 'NEXUS owner'},
  });
  const target = new URL(redirectTo);
  if (target.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(target.hostname)) return page('Ошибка', '<p>Недопустимый адрес возврата.</p>', 400);
  // Some embedded OAuth browsers ignore cross-origin redirects after a form POST — give a link too.
  const safe = escapeHtml(redirectTo);
  return new Response(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${safe}"><p>Доступ выдан. <a href="${safe}">Вернуться в ChatGPT</a></p>`,
    {status: 302, headers: {...HTML_HEADERS, location: redirectTo}});
}

/** PC registers / removes its current quick-tunnel URL. Auth: Bearer NEXUS_TOKEN. */
export async function handleTunnel(request, env) {
  if (!env.OAUTH_KV) return json(503, {error: 'not_configured'});
  if (!(await bearerOk(request, secret(env.NEXUS_TOKEN)))) return json(401, {error: 'unauthorized'});
  if (request.method === 'DELETE') { await env.OAUTH_KV.delete('tunnel'); return json(200, {ok: true, removed: true}); }
  if (request.method !== 'POST') return json(405, {error: 'method_not_allowed'});
  let body; try { body = await request.json(); } catch { return json(400, {error: 'bad_json'}); }
  if (typeof body?.url !== 'string' || !TUNNEL_RE.test(body.url)) return json(400, {error: 'invalid_tunnel_url'});
  await env.OAUTH_KV.put('tunnel', JSON.stringify({url: body.url, registeredAt: Date.now()}));
  return json(200, {ok: true});
}

/** OAuth apiHandler for /mcp: only reached with a valid OAuth token. Forwards JSON-RPC to the PC. */
export async function handleMcp(request, env, ctx, {fetcher = fetch} = {}) {
  if (request.method !== 'POST') return json(405, {error: 'method_not_allowed'}, {allow: 'POST'});
  if (ctx?.props?.owner !== true) return json(403, {error: 'forbidden'});
  const raw = await env.OAUTH_KV.get('tunnel');
  const offline = id => json(200, {jsonrpc: '2.0', id: id ?? null, error: {code: -32001, message: 'pc_offline: NEXUS Host is not connected'}});
  const body = await request.text();
  if (body.length > 64 * 1024) return json(413, {error: 'too_large'});
  let id = null; try { id = JSON.parse(body)?.id ?? null; } catch { /* PC will report parse error */ }
  if (!raw) return offline(id);
  const {url} = JSON.parse(raw);
  if (!TUNNEL_RE.test(url)) return offline(id);
  let r;
  try {
    r = await fetcher(url + '/mcp', {
      method: 'POST', body,
      headers: {'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + secret(env.NEXUS_TOKEN)},
      signal: AbortSignal.timeout(25000),
    });
  } catch { return offline(id); }
  if (r.status === 202) return new Response(null, {status: 202});
  if (r.status >= 500 || r.status === 404 || r.status === 530) return offline(id);
  return new Response(await r.text(), {status: r.status, headers: {'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store'}});
}
