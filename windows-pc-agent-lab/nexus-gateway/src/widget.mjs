/**
 * NEXUS 0.5.0 — Live View widget (MCP Apps, `text/html;profile=mcp-app`), served by the gateway via resources/read.
 *
 * Talks to the ChatGPT host ONLY over the MCP Apps postMessage JSON-RPC bridge (fallback: legacy window.openai).
 * Frames come from the app-only tool `live_frame` through the SAME OAuth-protected MCP connection the chat uses —
 * so the widget holds no token, no cookie, no URL of the PC, and needs no connectDomains (CSP: nothing external).
 * Pull model: a frame is requested only while the widget is visible and not paused. STOP calls live_control stop,
 * which switches live_view off at the source. The widget has no input/control function at all.
 */
import {LIVE_UI} from './catalog.mjs';

export const WIDGET_MIME = 'text/html;profile=mcp-app';

export const WIDGET_HTML = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NEXUS Live View</title>
<style>
:root{--bg:var(--color-background-primary,#0f1115);--fg:var(--color-text-primary,#e8eaed);--mut:var(--color-text-secondary,#9aa0a6);--line:var(--color-border-primary,#2a2f3a);--red:#e5484d;--amber:#f5a524;--green:#30a46c}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.bar{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.dot{width:9px;height:9px;border-radius:50%;background:var(--mut);flex:none}.live .dot{background:var(--red);animation:p 1.2s infinite}.paused .dot{background:var(--amber)}.offline .dot{background:#555}
@keyframes p{50%{opacity:.35}}
.st{font-weight:600;letter-spacing:.02em}.meta{color:var(--mut);margin-left:auto;font-variant-numeric:tabular-nums}
button,select{font:inherit;color:var(--fg);background:transparent;border:1px solid var(--line);border-radius:6px;padding:3px 8px;min-height:28px;cursor:pointer}
button:hover{border-color:var(--mut)}button.stop{border-color:var(--red);color:var(--red);font-weight:600}button[hidden]{display:none}
.view{position:relative;background:#000;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;overflow:hidden}
.fs .view{aspect-ratio:auto;height:calc(100vh - 44px)}
img{max-width:100%;max-height:100%;display:block;object-fit:contain}
.msg{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;text-align:center;color:var(--mut);background:rgba(0,0,0,.72)}
.msg[hidden]{display:none}.msg b{color:var(--fg)}
.foot{color:var(--mut);font-size:11px;padding:4px 8px}
</style></head>
<body class="offline">
<div class="bar">
  <span class="dot" aria-hidden="true"></span><span class="st" id="st">NEXUS · подключение…</span>
  <button id="pp" title="Пауза / продолжить">⏸</button>
  <select id="fps" title="Кадров в секунду" aria-label="Кадров в секунду"><option value="0.5">0.5 к/с</option><option value="1">1 к/с</option><option value="2" selected>2 к/с</option><option value="4">4 к/с</option></select>
  <button id="pip" hidden title="Картинка в картинке">⧉</button><button id="full" hidden title="Во весь экран">⛶</button>
  <button id="stop" class="stop" title="Остановить трансляцию на ПК">■ STOP</button>
  <span class="meta" id="meta"></span>
</div>
<div class="view"><img id="img" alt="Экран Windows владельца"><div class="msg" id="msg"><b id="mt">Подключение…</b><span id="md"></span><button id="ask" hidden>Попросить включить Live View</button></div></div>
<div class="foot">Только просмотр. Кадры не сохраняются. На экране могут быть личные данные — STOP выключает трансляцию на самом ПК.</div>
<script>
(() => {
  const $ = id => document.getElementById(id);
  let seq = 0, pending = new Map(), host = null, modes = [], mode = 'inline';
  let paused = false, stopped = false, busy = false, timer = null, fails = 0, lastSeq = -1, lastAt = 0;
  const legacy = () => typeof window.openai === 'object' && window.openai && typeof window.openai.callTool === 'function';

  // ── MCP Apps bridge (JSON-RPC 2.0 over postMessage) ──
  function rpc(method, params) {
    const id = ++seq;
    return new Promise((res, rej) => {
      pending.set(id, {res, rej});
      window.parent.postMessage({jsonrpc: '2.0', id, method, params}, '*');
      setTimeout(() => { if (pending.delete(id)) rej(new Error('timeout:' + method)); }, 30000);
    });
  }
  const notify = (method, params) => window.parent.postMessage({jsonrpc: '2.0', method, params}, '*');
  window.addEventListener('message', ev => {
    if (ev.source !== window.parent) return;
    const m = ev.data; if (!m || m.jsonrpc !== '2.0') return;
    if (m.id != null && pending.has(m.id) && !m.method) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message || 'error')) : p.res(m.result); return; }
    if (m.method === 'ui/notifications/host-context-changed' && m.params) ctx(m.params);
    if (m.method === 'ui/notifications/tool-result' && m.params) onStatus(m.params.structuredContent);
    if (m.method === 'ui/resource-teardown' && m.id != null) { halt(); window.parent.postMessage({jsonrpc: '2.0', id: m.id, result: {}}, '*'); }
  });
  function ctx(c) {
    if (Array.isArray(c.availableDisplayModes)) modes = c.availableDisplayModes;
    if (c.displayMode) mode = c.displayMode;
    $('pip').hidden = !modes.includes('pip') || mode === 'pip';
    $('full').hidden = !modes.includes('fullscreen') || mode === 'fullscreen';
    document.body.classList.toggle('fs', mode === 'fullscreen');
    size();
  }
  const size = () => { if (host) notify('ui/notifications/size-changed', {height: Math.ceil(document.documentElement.getBoundingClientRect().height)}); };

  async function callTool(name, args) {
    if (host) return rpc('tools/call', {name, arguments: args || {}});
    if (legacy()) return window.openai.callTool(name, args || {});
    throw new Error('no_host_bridge');
  }
  async function displayMode(m) {
    try {
      if (host) { const r = await rpc('ui/request-display-mode', {mode: m}); ctx({displayMode: r && r.mode || mode}); }
      else if (legacy() && window.openai.requestDisplayMode) { await window.openai.requestDisplayMode({mode: m}); ctx({displayMode: m}); }
    } catch (e) { show('Режим недоступен', String(e.message || e)); }
  }

  // ── UI state ──
  function setState(cls, text) { document.body.className = cls + (mode === 'fullscreen' ? ' fs' : ''); $('st').textContent = text; }
  function show(t, d, ask) { $('mt').textContent = t; $('md').textContent = d || ''; $('ask').hidden = !ask; $('msg').hidden = false; }
  const hide = () => { $('msg').hidden = true; };
  function onStatus(s) {
    if (!s || typeof s !== 'object') return;
    if (s.state === 'off') { stopped = true; halt(); setState('offline', 'NEXUS · Live View выключен'); show('Live View выключен', 'Трансляция включается только по твоей просьбе в чате.', true); }
  }
  function halt() { clearTimeout(timer); timer = null; }
  function schedule(ms) { halt(); if (!paused && !stopped) timer = setTimeout(tick, ms); }
  const interval = () => Math.round(1000 / Number($('fps').value || 2));

  async function tick() {
    if (busy || paused || stopped) return;
    if (document.visibilityState === 'hidden') return schedule(1000); // no viewer → no frames
    busy = true;
    try {
      const r = await callTool('live_frame', {maxWidth: mode === 'fullscreen' ? 1600 : 960, quality: 60});
      const sc = r && r.structuredContent;
      if (r && r.isError) throw new Error((r.content && r.content[0] && r.content[0].text) || 'error');
      if (!sc || sc.state === 'off') { onStatus({state: 'off'}); return; }
      const im = (r.content || []).find(c => c.type === 'image');
      if (im && sc.seq !== lastSeq) { $('img').src = 'data:' + im.mimeType + ';base64,' + im.data; lastSeq = sc.seq; lastAt = Date.now(); }
      fails = 0; hide();
      setState('live', 'LIVE · Windows');
      $('meta').textContent = (sc.imageW || '?') + '×' + (sc.imageH || '?') + (sc.cursor ? ' · курсор ' + sc.cursor.x + ',' + sc.cursor.y : '');
      schedule(interval());
    } catch (e) {
      fails++;
      const t = String(e.message || e);
      setState('offline', /pc_offline|pc_timeout/.test(t) ? 'NEXUS · ПК офлайн' : 'NEXUS · ошибка');
      show(/pc_offline/.test(t) ? 'ПК не на связи' : 'Нет кадра', t.slice(0, 220));
      schedule(Math.min(15000, 1000 * 2 ** Math.min(fails, 4)));
    } finally { busy = false; }
  }

  $('pp').onclick = () => { paused = !paused; $('pp').textContent = paused ? '▶' : '⏸'; if (paused) { halt(); setState('paused', 'ПАУЗА · кадры не запрашиваются'); } else { stopped = false; tick(); } };
  $('fps').onchange = () => schedule(0);
  $('pip').onclick = () => displayMode('pip');
  $('full').onclick = () => displayMode(mode === 'fullscreen' ? 'inline' : 'fullscreen');
  $('stop').onclick = async () => {
    stopped = true; halt(); $('img').removeAttribute('src');
    setState('offline', 'STOP…');
    try { await callTool('live_control', {action: 'stop'}); setState('offline', 'NEXUS · остановлено'); show('Трансляция остановлена на ПК', 'live_view выключен. Включить снова можно только просьбой в чате.', true); }
    catch (e) { show('STOP не дошёл до ПК', String(e.message || e) + ' — закрой окно NEXUS Host на ПК, это выключает всё.'); }
  };
  $('ask').onclick = async () => {
    const text = 'Включи Live View NEXUS и покажи экран.';
    try { if (host) await rpc('ui/message', {role: 'user', content: {type: 'text', text}}); else if (legacy() && window.openai.sendFollowUpMessage) await window.openai.sendFollowUpMessage({prompt: text}); else throw 0; }
    catch { show('Напиши в чате:', '«' + text + '»'); }
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(0); });

  (async () => {
    try {
      const init = await Promise.race([
        rpc('ui/initialize', {appInfo: {name: 'nexus-live-view', version: '0.5.0'}, appCapabilities: {availableDisplayModes: ['inline', 'pip', 'fullscreen']}, protocolVersion: '2026-01-26'}),
        new Promise((_, rej) => setTimeout(() => rej(new Error('no_mcp_apps_host')), 4000)),
      ]);
      host = init || {}; notify('ui/notifications/initialized', {});
      ctx(host.hostContext || {});
    } catch {
      host = null; pending.clear();
      if (legacy()) { const g = window.openai; ctx({displayMode: g.displayMode || 'inline', availableDisplayModes: ['inline', 'pip', 'fullscreen']}); onStatus(g.toolOutput); }
      else { setState('offline', 'NEXUS · нет моста'); show('Клиент не поддерживает встроенный виджет', 'Используй внешний Live View: ссылка /live на шлюзе NEXUS.'); return; }
    }
    tick();
  })();
})();
</script></body></html>`;

/** resources/list + resources/read payloads (MCP Apps + legacy OpenAI keys). No external origins are allowed. */
export const WIDGET_RESOURCE = {uri: LIVE_UI, name: 'NEXUS Live View', description: 'Live view of the owner\'s Windows screen (view only).', mimeType: WIDGET_MIME};
export function widgetContents() {
  const csp = {connectDomains: [], resourceDomains: [], frameDomains: []};
  return [{uri: LIVE_UI, mimeType: WIDGET_MIME, text: WIDGET_HTML,
    _meta: {ui: {csp, prefersBorder: true}, 'openai/widgetCSP': {connect_domains: [], resource_domains: []}, 'openai/widgetPrefersBorder': true,
      'openai/widgetDescription': 'Live view of the owner\'s Windows screen. View only; STOP switches the stream off at the PC.'}}];
}
