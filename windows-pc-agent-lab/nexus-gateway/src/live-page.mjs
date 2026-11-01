/**
 * NEXUS 0.5.0 — external Live View page on the gateway (variant B; works when the ChatGPT client does not render the
 * widget). Phone/PC browser → https://<gateway>/live.
 *
 * Security:
 *  - Login with the OWNER PASSPHRASE through the same ConsentGuard Durable Object as OAuth consent: single-use nonce,
 *    shared brute-force lockout (5 fails → 15 min).
 *  - Session = cookie `__Host-nx_live` (HttpOnly; Secure; SameSite=Strict; Path=/; 30 min), payload signed with HMAC-SHA256.
 *    Key derived from NEXUS_TOKEN + LIVE_SESSION_EPOCH (no new secret; bump the epoch var to revoke all sessions).
 *    Nothing secret ever appears in a URL, the page, JavaScript or logs.
 *  - Frames: GET /live/frame → gateway calls the PC's app-only tool live_frame over the tunnel with NEXUS_TOKEN
 *    (server side) → image/jpeg, Cache-Control: no-store. The PC still requires capability live_view=true.
 *  - STOP: POST /live/stop with header X-Nexus-Live: 1 (CSRF: SameSite=Strict + custom header) → live_control stop.
 *  - Strict CSP with a per-response script nonce; frame-ancestors 'none'.
 */
const enc = new TextEncoder();
export const SESSION_TTL_MS = 30 * 60_000;
export const COOKIE = '__Host-nx_live';
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = s => b64u(enc.encode(s));
const fromB64u = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

async function hmacKey(env) {
  const token = typeof env.NEXUS_TOKEN === 'string' ? env.NEXUS_TOKEN.trim() : '';
  if (token.length < 32) throw Error('not_configured');
  const material = await crypto.subtle.digest('SHA-256', enc.encode(`nexus-live-session-v1|${env.LIVE_SESSION_EPOCH || '1'}|${token}`));
  return crypto.subtle.importKey('raw', material, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
}
export async function makeSession(env, now = Date.now()) {
  const rnd = new Uint8Array(16); crypto.getRandomValues(rnd);
  const payload = b64uStr(JSON.stringify({sid: b64u(rnd), exp: now + SESSION_TTL_MS}));
  const sig = b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(payload)));
  return `${payload}.${sig}`;
}
export async function readSession(request, env, now = Date.now()) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{10,400})\\.([A-Za-z0-9_-]{43})(?:;|$)`).exec(request.headers.get('cookie') || '');
  if (!m) return null;
  let key; try { key = await hmacKey(env); } catch { return null; }
  const sig = Uint8Array.from(atob(m[2].replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0));
  if (!(await crypto.subtle.verify('HMAC', key, sig, enc.encode(m[1])))) return null;
  let p; try { p = JSON.parse(fromB64u(m[1])); } catch { return null; }
  return Number.isFinite(p.exp) && p.exp > now && p.exp <= now + SESSION_TTL_MS ? p : null;
}
const cookieSet = v => `${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;
const cookieClear = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

function nonce() { const b = new Uint8Array(16); crypto.getRandomValues(b); return b64u(b); }
const sec = {'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'permissions-policy': 'camera=(), microphone=(), geolocation=()'};
function html(body, {status = 200, n = null, headers = {}} = {}) {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src blob:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'${n ? `; script-src 'nonce-${n}'` : ''}`;
  return new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NEXUS Live View</title>${body}</html>`,
    {status, headers: {...sec, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp, ...headers}});
}
const jsonR = (status, body, headers = {}) => new Response(JSON.stringify(body), {status, headers: {...sec, 'content-type': 'application/json', ...headers}});
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
const STYLE = '<style>body{font:15px system-ui;margin:0;background:#0f1115;color:#e8eaed}main{max-width:420px;margin:48px auto;padding:0 16px}input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #2a2f3a;background:#161a22;color:inherit;width:100%}button{cursor:pointer;margin-top:10px}.w{color:#f5a524}</style>';

function loginPage(n, msg = '', status = 200) {
  return html(`${STYLE}<main><h1>NEXUS Live View</h1><p>Просмотр экрана твоего Windows. Только для владельца.</p>${msg ? `<p class="w">${esc(msg)}</p>` : ''}
<form method="POST" action="/live/login"><input type="hidden" name="nonce" value="${n}"><label>Пароль владельца<br><input type="password" name="passphrase" autocomplete="current-password" required></label><button type="submit">Войти (сессия 30 мин)</button></form>
<p style="color:#9aa0a6;font-size:13px">Трансляция идёт, только пока эта страница открыта и на ПК включён live_view. Кадры нигде не сохраняются.</p></main>`, {status});
}

function viewerPage() {
  const n = nonce();
  return html(`<style>body{margin:0;background:#000;color:#e8eaed;font:13px system-ui}.bar{position:sticky;top:0;display:flex;gap:6px;align-items:center;padding:6px 8px;background:#0f1115;border-bottom:1px solid #2a2f3a;flex-wrap:wrap}
.dot{width:9px;height:9px;border-radius:50%;background:#555}.live .dot{background:#e5484d}.paused .dot{background:#f5a524}button,select{font:inherit;color:inherit;background:transparent;border:1px solid #2a2f3a;border-radius:6px;padding:4px 9px}
.stop{border-color:#e5484d;color:#e5484d;font-weight:600}#m{color:#9aa0a6;margin-left:auto}img{display:block;max-width:100vw;max-height:calc(100vh - 44px);margin:0 auto}#x{padding:24px;text-align:center;color:#9aa0a6}</style>
<body class="offline"><div class="bar"><span class="dot"></span><b id="s">подключение…</b><button id="pp">⏸</button>
<select id="f"><option value="0.5">0.5 к/с</option><option value="1">1 к/с</option><option value="2" selected>2 к/с</option><option value="4">4 к/с</option></select>
<button id="fs">⛶</button><button id="st" class="stop">■ STOP</button><button id="lo">Выйти</button><span id="m"></span></div>
<img id="i" alt="Экран Windows"><div id="x"></div>
<script nonce="${n}">
(() => {
  const $ = id => document.getElementById(id); let paused = false, stopped = false, t = null, fails = 0, url = null, busy = false;
  const state = (c, s, x) => { document.body.className = c; $('s').textContent = s; $('x').textContent = x || ''; };
  const sched = ms => { clearTimeout(t); if (!paused && !stopped) t = setTimeout(tick, ms); };
  async function tick() {
    if (busy) return; if (document.visibilityState === 'hidden') return sched(1000);
    busy = true;
    try {
      const r = await fetch('/live/frame?w=' + (innerWidth > 1100 ? 1600 : 960), {cache: 'no-store', credentials: 'same-origin'});
      if (r.status === 401) { location.href = '/live'; return; }
      if (r.status === 204) { state('offline', 'нет активной задачи', 'Кадры идут только пока NEXUS работает на рабочем столе.'); return sched(5000); }
      if (r.status === 409) { stopped = true; state('offline', 'Live View выключен', 'Включается только по твоей просьбе в чате ChatGPT («включи Live View»), затем обнови страницу.'); return; }
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || ('HTTP ' + r.status));
      const b = await r.blob(); const u = URL.createObjectURL(b); $('i').src = u; if (url) URL.revokeObjectURL(url); url = u;
      fails = 0; state('live', 'LIVE · Windows'); $('m').textContent = r.headers.get('x-nexus-frame') || '';
      sched(Math.round(1000 / Number($('f').value)));
    } catch (e) { fails++; state('offline', 'нет кадра', String(e.message || e)); sched(Math.min(15000, 1000 * 2 ** Math.min(fails, 4))); }
    finally { busy = false; }
  }
  $('pp').onclick = () => { paused = !paused; $('pp').textContent = paused ? '▶' : '⏸'; if (paused) { clearTimeout(t); state('paused', 'ПАУЗА'); } else tick(); };
  $('f').onchange = () => sched(0);
  $('fs').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  $('st').onclick = async () => { stopped = true; clearTimeout(t); $('i').removeAttribute('src');
    const r = await fetch('/live/stop', {method: 'POST', headers: {'x-nexus-live': '1'}, credentials: 'same-origin'}).catch(() => null);
    state('offline', r && r.ok ? 'остановлено на ПК' : 'STOP не дошёл', r && r.ok ? 'live_view выключен на ПК.' : 'Закрой окно NEXUS Host на ПК — это выключает всё.'); };
  $('lo').onclick = async () => { await fetch('/live/logout', {method: 'POST', headers: {'x-nexus-live': '1'}, credentials: 'same-origin'}); location.href = '/live'; };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sched(0); });
  tick();
})();
</script></body>`, {n});
}

/**
 * Routes under /live. `callHost(name, args)` → {ok:true, result} | {ok:false, reason, text}.
 */
export async function handleLive(request, env, {callHost, sha256hex}) {
  const url = new URL(request.url);
  const p = url.pathname;
  const expected = typeof env.OWNER_PASSPHRASE_SHA256 === 'string' ? env.OWNER_PASSPHRASE_SHA256.trim().toLowerCase() : '';
  if (!env.CONSENT_GUARD || !/^[a-f0-9]{64}$/.test(expected)) return new Response('Gateway not configured', {status: 503});
  const guard = env.CONSENT_GUARD.get(env.CONSENT_GUARD.idFromName('owner'));
  const session = await readSession(request, env);

  if (p === '/live' && request.method === 'GET') {
    if (session) return viewerPage();
    return loginPage(await guard.issue({kind: 'live_login'}));
  }
  if (p === '/live/login' && request.method === 'POST') {
    const form = await request.formData();
    const n = String(form.get('nonce') || '');
    if (!/^[a-f0-9]{64}$/.test(n)) return loginPage(await guard.issue({kind: 'live_login'}), 'Сессия входа недействительна.', 400);
    const r = await guard.attempt({nonce: n, passphraseSha256: await sha256hex(String(form.get('passphrase') || '')), approve: true, expectedSha256: expected});
    if (r.status === 'ok' && r.auth?.kind === 'live_login') {
      console.log(JSON.stringify({nexus: 'live_login', ok: true}));
      return new Response(null, {status: 303, headers: {...sec, location: '/live', 'set-cookie': cookieSet(await makeSession(env))}});
    }
    console.log(JSON.stringify({nexus: 'live_login', ok: false, status: r.status}));
    const msg = r.status === 'locked' ? `Слишком много неверных попыток. Повтори через ${Math.ceil(r.retryAfterMs / 60000)} мин.` :
      r.status === 'bad_passphrase' ? `Неверный пароль. Осталось попыток: ${r.remaining}.` : 'Сессия входа истекла. Попробуй ещё раз.';
    return loginPage(await guard.issue({kind: 'live_login'}), msg, r.status === 'locked' ? 429 : 403);
  }
  if (!session) return jsonR(401, {error: 'unauthorized'});
  if (p === '/live/frame' && request.method === 'GET') {
    const w = Number(url.searchParams.get('w') || 960);
    const r = await callHost('live_frame', {maxWidth: [960, 1600].includes(w) ? w : 960, quality: 60});
    if (!r.ok) return jsonR(503, {error: r.reason});
    const sc = r.result?.structuredContent;
    if (sc?.state === 'off') return jsonR(409, {error: 'live_view_off'});
    if (sc?.state === 'ready') return new Response(null, {status: 204, headers: sec}); // 0.5.1: no task running → no frame (the page keeps waiting slowly)
    const img = (r.result?.content || []).find(c => c.type === 'image' && c.mimeType === 'image/jpeg');
    if (!img || typeof img.data !== 'string') return jsonR(502, {error: r.result?.isError ? String(r.result?.content?.[0]?.text || 'host_error').slice(0, 120) : 'no_frame'});
    const bytes = Uint8Array.from(atob(img.data), c => c.charCodeAt(0));
    return new Response(bytes, {status: 200, headers: {...sec, 'content-type': 'image/jpeg', 'x-nexus-frame': `${sc?.imageW}x${sc?.imageH}${sc?.cursor ? ` cursor ${sc.cursor.x},${sc.cursor.y}` : ''}`}});
  }
  if ((p === '/live/stop' || p === '/live/logout') && request.method === 'POST') {
    if (request.headers.get('x-nexus-live') !== '1') return jsonR(403, {error: 'csrf'});
    if (p === '/live/logout') return jsonR(200, {ok: true}, {'set-cookie': cookieClear});
    const r = await callHost('live_control', {action: 'stop'});
    console.log(JSON.stringify({nexus: 'live_stop', ok: r.ok}));
    return r.ok ? jsonR(200, {ok: true, state: 'off'}) : jsonR(503, {error: r.reason});
  }
  return jsonR(404, {error: 'not_found'});
}
