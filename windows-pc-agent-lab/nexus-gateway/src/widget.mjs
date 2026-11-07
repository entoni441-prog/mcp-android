/**
 * NEXUS 0.5.0 — Live View widget (MCP Apps, `text/html;profile=mcp-app`), served by the gateway via resources/read.
 *
 * Talks to the ChatGPT host ONLY over the MCP Apps postMessage JSON-RPC bridge (fallback: legacy window.openai).
 * Frames come from the app-only tool `live_frame` through the SAME OAuth-protected MCP connection the chat uses —
 * so the widget holds no PC token or cookie. Owner approval uses direct HTTPS to the owned Gateway only.
 * Pull model: a frame is requested only while the widget is visible and not paused. STOP calls live_control stop,
 * which switches live_view off at the source. Owner touch/text are opt-in and remain subject to Host policy.
 */
import {LIVE_UI} from './catalog.mjs';
import {framePointToScreen} from './widget-input.mjs';

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
.owner{border-top:1px solid var(--line);padding:8px;display:grid;gap:8px}.owner-head{display:flex;align-items:center;gap:8px;justify-content:space-between}.owner form{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.owner input{min-width:120px;flex:1;background:var(--bg);border:1px solid var(--line);border-radius:6px;color:var(--fg);padding:8px;font:inherit}.owner-entry{border:1px solid var(--line);padding:7px;border-radius:6px;overflow-wrap:anywhere}.owner-entry p{margin:2px 0 8px}.owner-actions{display:flex;gap:6px;flex-wrap:wrap}.owner-status{font-size:12px;color:var(--mut)}.owner button:disabled{opacity:.55;cursor:wait}.owner button.allow{border-color:var(--green);color:var(--green)}.boot{border-top:1px solid var(--line);padding:8px;display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap}.boot b{white-space:nowrap}.boot span{color:var(--mut)}

/* The approval surface appears above Live itself; the existing inline panel is the fallback. */
.bar{position:relative;z-index:110} /* STOP remains available even while approval overlay is open */
.owner.is-popup{position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.88);padding:12px;display:flex;flex-direction:column;justify-content:center;align-items:stretch;max-width:100vw}
.owner.is-popup .owner-head,.owner.is-popup #owner-panel{width:min(440px,100%);margin:0 auto;background:var(--bg);padding:10px;border:1px solid var(--line)}
.owner.is-popup .owner-head{border-radius:10px 10px 0 0}.owner.is-popup #owner-panel{max-height:75vh;overflow-y:auto;border-top:none;border-radius:0 0 10px 10px}
.owner.is-popup #owner-panel[hidden],.touch-tools[hidden]{display:none}
.owner.is-popup #owner-secret{font-size:16px;min-height:42px}
/* Keep both NEXUS status sections short unless explicitly expanded. */
.boot,.owner:not(.is-popup){padding:5px 8px;gap:4px}
.boot-head,.owner-head{display:flex;align-items:center;justify-content:space-between;gap:7px;min-height:30px}
.boot-head b,.owner-head b{white-space:nowrap;font-size:12px}
.boot-head #boot-state{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--mut);min-width:0}
.boot-head button,.owner-head button{flex:none;font-size:12px;padding:2px 7px;min-height:26px}
#boot-hint:not([hidden]){display:block;padding:3px 0 6px;font-size:11px;color:var(--mut)}
#boot-hint[hidden],#owner-panel[hidden],#owner-fallback[hidden]{display:none!important}
.owner:not(.is-popup) #owner-panel{max-height:min(45vh,300px);overflow:auto;padding:6px 0}
#owner-mini{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:11px;color:var(--mut)}
.owner.is-popup #owner-mini{display:none}
#owner-fallback{display:inline-block;font-size:12px;color:var(--fg);padding:5px 0;text-decoration:underline}

.touch-tools{border-top:1px solid var(--line);padding:8px;display:grid;gap:7px}
.touch-tools form{display:flex;gap:6px}.touch-tools input{flex:1;min-width:0;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px;font:16px system-ui}
.touch-tools .keys{display:flex;flex-wrap:wrap;gap:6px}.touch-tools .notice{font-size:11px;color:var(--amber)}
#img.touchable{cursor:crosshair;touch-action:manipulation}
.touch-tools{position:fixed;inset:0;z-index:105;background:rgba(0,0,0,.70);display:flex;align-items:flex-end;justify-content:center;padding:12px}
.touch-tools[hidden]{display:none!important}
.touch-card{width:min(460px,100%);background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:12px;max-height:65vh;overflow:auto;box-shadow:0 12px 40px #0009}
.touch-head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.touch-tools input{min-height:44px}
#touch-mini[hidden]{display:none!important}
#touch-mini{font-size:11px;color:var(--mut);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

</style></head>
<body class="offline">
<div class="bar">
  <span class="dot" aria-hidden="true"></span><span class="st" id="st">NEXUS · подключение…</span>
  <button id="pp" title="Пауза / продолжить">⏸</button>
  <button id="touch-toggle" type="button" aria-pressed="false" title="Прямое управление экраном, только по команде владельца">Управление: выкл.</button>
  <button id="touch-open" type="button" hidden aria-label="Открыть клавиатуру Samsung для ввода текста">⌨</button>
  <select id="fps" title="Кадров в секунду" aria-label="Кадров в секунду"><option value="0.5">0.5 к/с</option><option value="1">1 к/с</option><option value="2" selected>2 к/с</option><option value="4">4 к/с</option></select>
  <button id="pip" hidden title="Картинка в картинке">⧉</button><button id="full" hidden title="Во весь экран">⛶</button>
  <button id="stop" class="stop" title="Остановить трансляцию на ПК">■ STOP</button>
  <span class="meta" id="meta"></span>
</div>
<div class="view"><img id="img" alt="Экран Windows владельца"><div class="msg" id="msg"><b id="mt">Подключение…</b><span id="md"></span><button id="ask" hidden>Попросить включить Live View</button></div></div>
<div class="touch-tools" id="touch-tools" hidden role="dialog" aria-label="Ввод текста в Windows">
  <div class="touch-card">
    <div class="touch-head"><b>Текст в Windows</b><button id="touch-close" type="button" aria-label="Скрыть клавиатуру">Скрыть</button></div>
    <span class="notice">Только обычный текст. Не вводи PIN, пароль, код, токен или платёжные данные.</span>
    <form id="touch-form" autocomplete="off"><input id="touch-text" type="text" inputmode="text" enterkeyhint="send" maxlength="500" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Ввод через клавиатуру Samsung" placeholder="Нажми сюда для клавиатуры Samsung"><button type="submit">Отправить</button></form>
    <div class="keys"><button data-touch-key="enter" type="button">Enter</button><button data-touch-key="tab" type="button">Tab</button><button data-touch-key="backspace" type="button">⌫</button><button data-touch-key="esc" type="button">Esc</button></div>
  </div>
</div>
<div id="touch-mini" role="status" hidden>Управление готово</div>
<div class="boot" aria-label="Статус запуска и входа Windows">
  <div class="boot-head"><b>Доступ после запуска</b><span id="boot-state" role="status">Проверка…</span><button id="boot-toggle" type="button" aria-expanded="false">Подробнее</button></div>
  <span id="boot-hint" hidden>Защищённый дистанционный вход до Windows пока не настроен. Пароль Windows сюда не вводи.</span>
</div>
<div class="owner" id="owner-container" aria-label="Подтверждения владельца NEXUS">
  <div class="owner-head"><b>Подтверждения владельца</b><span id="owner-mini">Скрыто</span><button id="owner-toggle" type="button" aria-expanded="false">Показать</button></div>
  <div id="owner-panel" hidden>
    <p class="owner-status">Пароль <b>владельца NEXUS</b> нужен отдельно для каждой операции. Это не PIN и не пароль Windows. Данные передаются напрямую в NEXUS Gateway, не через инструменты модели.</p>
    <form id="owner-form" autocomplete="off"><input id="owner-secret" type="password" autocomplete="off" required aria-label="Пароль владельца NEXUS" placeholder="Пароль владельца NEXUS"><button id="owner-refresh" type="submit">Проверить заявки</button></form>
    <p id="owner-status" class="owner-status" role="status">Нет загруженных заявок.</p>
    <a id="owner-fallback" href="https://nexus-gateway.entoni441.workers.dev/live" target="_blank" rel="noopener noreferrer" hidden>Открыть резервное подтверждение NEXUS</a>
    <div id="owner-list"></div>
  </div>
</div>
<div class="foot">Просмотр по умолчанию; прямое управление включается вручную и проверяется Host. Кадры не сохраняются. STOP выключает трансляцию на ПК.</div>
<script>
(() => {
  const $ = id => document.getElementById(id);
  const framePointToScreen = ${framePointToScreen.toString()};
  let seq = 0, pending = new Map(), host = null, modes = [], mode = 'inline';
  let paused = false, stopped = false, busy = false, timer = null, fails = 0, lastSeq = -1, lastAt = 0;
  let frameGeometry=null, touchEnabled=false, touchBusy=false, pointerStart=null, touchConsent=null;
  let lastTap=null, tapTimer=null, lastStatusTimer=null;
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
    if (m.method === 'ui/resource-teardown' && m.id != null) { stopped = true; halt(); clearTimeout(bootTimer); clearTimeout(ownerAlertTimer); window.parent.postMessage({jsonrpc: '2.0', id: m.id, result: {}}, '*'); }
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
    if (s.state === 'off') { stopped = true; frameGeometry=null; touchConsent=null; resetTouch(); if (ownerPopup) dismissOwnerPopup(); halt(); setState('offline', 'NEXUS · Live View выключен'); show('Live View выключен', 'Трансляция включается только по твоей просьбе в чате.', true); }
  }
  let readySince = 0;
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
      // 0.5.1: grant on, but no task runs → the PC produces no frames; poll slowly, give up after 10 min idle.
      if (sc.state === 'ready') {
        frameGeometry=null; if (touchEnabled) resetTouch();
        readySince = readySince || Date.now();
        setState('offline', 'NEXUS · задача завершена');
        show('Нет активной задачи', 'Трансляция идёт только во время работы NEXUS на рабочем столе. Кадры появятся сами при следующей задаче.', false);
        if (Date.now() - readySince > 600000) { stopped = true; halt(); return; }
        return schedule(5000);
      }
      readySince = 0;
      const im = (r.content || []).find(c => c.type === 'image');
      if (im && sc.seq !== lastSeq) { $('img').src = 'data:' + im.mimeType + ';base64,' + im.data; lastSeq = sc.seq; lastAt = Date.now(); frameGeometry={screenW:sc.screenW,screenH:sc.screenH,imageW:sc.imageW,imageH:sc.imageH}; }
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



  // ── PRELOGON-STATUS-01: honest read-only status, NOT a credential channel ──
  // Gateway connection_status works even if the Windows user's Host is offline.
  // Never assume 'host offline' means 'login required': tunnel and power outages
  // are also possible. No PIN/password fields until an independently secured
  // pre-logon login service is built and independently tested.
  let bootTimer = null, bootBusy = false;
  async function checkBootStatus() {
    if (bootBusy || document.visibilityState === 'hidden' || stopped) return;
    bootBusy = true;
    try {
      const r = await callTool('connection_status', {});
      const sc = r && r.structuredContent;
      if (!sc || r.isError) throw new Error('connection_status_unavailable');
      const verdict = String(sc.verdict || 'unknown');
      $('boot-state').textContent = verdict === 'online' ? 'HOST_ONLINE · NEXUS подключён'
        : 'HOST_OFFLINE · нет подтверждённого подключения (' + verdict.slice(0,30) + ')';
      $('boot-hint').textContent = verdict === 'online'
        ? 'NEXUS доступен. Этот статус сам по себе не доказывает возможность входа после перезагрузки.'
        : 'Ожидаю Host. Наличие экрана входа Windows до запуска Host пока не подтверждено; дистанционный вход не активирован.';
      // Do not infer LOGIN_REQUIRED from offline or silently lift logonChannelVerified.
    } catch {
      $('boot-state').textContent = 'Статус Windows недоступен';
      $('boot-hint').textContent = 'Проверь соединение. Пароль Windows здесь не запрашивается.';
    } finally {bootBusy = false;size();}
  }
  function bootSchedule() {
    clearTimeout(bootTimer);
    if (!stopped) bootTimer = setTimeout(async()=>{await checkBootStatus();bootSchedule();},15000);
  }
  $('boot-toggle').onclick = () => {
    const detail=$('boot-hint');
    detail.hidden=!detail.hidden;
    $('boot-toggle').textContent=detail.hidden?'Подробнее':'Скрыть';
    $('boot-toggle').setAttribute('aria-expanded',String(!detail.hidden));
    size();
  };

  // ── NX-CHAT-OWNER-01: privileged owner approvals, out-of-band from MCP ──
  // The model and MCP Apps host NEVER receive the password, nonce or decision.
  // TLS POST goes directly to our owned Cloudflare gateway from this iframe.
  const OWNER_ORIGIN = 'https://nexus-gateway.entoni441.workers.dev';
  let ownerEntries = [], ownerBusy = false;
  let ownerAlertTimer=null, ownerAlertBusy=false, seenPending=0, pendingCount=0, snoozeOwnerUntil=0, ownerPopup=false;
  const ownerPanel = $('owner-panel'), ownerSecret = $('owner-secret'), ownerContainer = $('owner-container');
  function dismissOwnerPopup() {
    ownerPopup=false;
    ownerContainer.classList.remove('is-popup');
    $('owner-mini').textContent= pendingCount>0 ? 'Есть заявки: '+pendingCount : 'Нет заявок';
    ownerPanel.hidden=true;
    ownerSecret.value='';
    $('owner-toggle').textContent='Показать';
    $('owner-toggle').setAttribute('aria-expanded','false');
    snoozeOwnerUntil=Date.now()+120000;
    size();
  }
  function showOwnerPopup(count) {
    if (ownerPopup || !ownerPanel.hidden || stopped) return;
    ownerPopup=true;
    $('owner-mini').textContent='Запросов: '+count;
    resetTouch();
    ownerContainer.classList.add('is-popup');
    ownerPanel.hidden=false;
    $('owner-toggle').textContent='Скрыть';
    $('owner-toggle').setAttribute('aria-expanded','true');
    ownerMessage('Новых запросов: ' + count + '. Введи пароль владельца NEXUS для просмотра. Windows PIN не подходит.');
    size();
  }
  async function checkOwnerAlerts() {
    if (ownerAlertBusy || document.visibilityState === 'hidden' || stopped) return;
    ownerAlertBusy=true;
    try {
      // Read only the COUNT through the existing OAuth MCP connection.
      // Targets and decisions still require direct reauthentication at Gateway.
      const r=await callTool('host_diagnostics',{});
      const count=Number(r?.structuredContent?.pendingConsents);
      if (r?.isError || !Number.isSafeInteger(count) || count<0) return;
      pendingCount=count;
      $('owner-mini').textContent=count>0?'Запросов: '+count:'Нет заявок';
      if (count===0) {
        snoozeOwnerUntil=0;
        if (ownerPopup) dismissOwnerPopup();
      }
      if (count>0 && (seenPending===0 || count>seenPending || Date.now()>snoozeOwnerUntil) &&
          !ownerPopup && ownerPanel.hidden && (Date.now()>snoozeOwnerUntil || count>seenPending)) showOwnerPopup(count);
      seenPending=count;
    } catch { /* no change: manual approval panel remains available */ }
    finally { ownerAlertBusy=false; }
  }
  function scheduleOwnerAlerts() {
    clearTimeout(ownerAlertTimer);
    if (!stopped) ownerAlertTimer=setTimeout(async()=>{await checkOwnerAlerts();scheduleOwnerAlerts();},8000);
  }
  $('owner-toggle').onclick = () => {
    if (ownerPopup) return dismissOwnerPopup();
    ownerPanel.hidden = !ownerPanel.hidden;
    $('owner-toggle').textContent = ownerPanel.hidden ? 'Показать' : 'Скрыть';
    $('owner-toggle').setAttribute('aria-expanded', String(!ownerPanel.hidden));
    if (ownerPanel.hidden) ownerSecret.value='';
    size();
  };
  function ownerMessage(message) { $('owner-status').textContent = message; size(); }
  async function ownerPost(route, body) {
    const r = await fetch(OWNER_ORIGIN + route, {
      method:'POST',mode:'cors',cache:'no-store',credentials:'omit',
      headers:{'content-type':'application/json','x-nexus-widget':'1'},
      body:JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({error:'bad_reply'}));
    if (!r.ok) throw new Error(String(j.error || 'gateway_error').slice(0,100));
    return j;
  }
  async function ownerRequest(operation, extra) {
    if (ownerBusy) return null;
    const pass = ownerSecret.value;
    if (!pass) { ownerMessage('Введи пароль владельца NEXUS. Не вводи сюда PIN Windows.'); return null; }
    ownerBusy = true;
    $('owner-fallback').hidden=true;
    $('owner-refresh').disabled = true;
    try {
      // Each operation consumes a fresh 256-bit challenge, verified by
      // existing GuardCore lockout and one-time nonce; never sent to model.
      const challenge = await ownerPost('/live/widget/challenge',
        {operation, ...(extra || {})});
      const result = await ownerPost('/live/widget/perform',
        {nonce:challenge.nonce,passphrase:pass});
      return result;
    } catch(e) {
      const message=String(e.message || e);
      const transport=/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(message);
      $('owner-fallback').hidden=!transport;
      if (transport) {
        $('owner-mini').textContent='Нет связи с формой';
        ownerMessage('Нет соединения с Gateway из встроенной формы ChatGPT. Действие не подтверждено. Используй резервную страницу NEXUS; секреты в чат не вводи.');
      } else ownerMessage('Подтверждение не выполнено: ' + message.slice(0,100));
      return null;
    } finally {
      ownerSecret.value = ''; // do not persist user-entered secrets
      ownerBusy = false;
      $('owner-refresh').disabled = false;
      size();
    }
  }
  function renderOwnerEntries() {
    const el = $('owner-list'); el.textContent = '';
    const labels = {allow:'Разрешить',cancel:'Отклонить',
      close_save:'Сохранить и закрыть',close_discard:'Закрыть без сохранения'};
    if (!ownerEntries.length) {
      ownerMessage('Заявок на подтверждение сейчас нет.');
      $('owner-mini').textContent='Нет заявок';
      dismissOwnerPopup();
      return;
    }
    ownerMessage('Ожидающие запросы: ' + ownerEntries.length);
    for (const c of ownerEntries) {
      const div = document.createElement('div'); div.className='owner-entry';
      const title = document.createElement('p');
      title.textContent = c.target + ' · ' + Math.ceil(c.expiresInSec / 60) + ' мин';
      div.appendChild(title);
      const actions = document.createElement('div');actions.className='owner-actions';
      for (const decision of c.options) {
        const b=document.createElement('button'); b.type='button';
        b.textContent = labels[decision] || decision;
        if (decision==='allow') b.className='allow';
        b.onclick=async()=>{
          // Never authorize on a single unauthenticated click.
          // Each action requires the owner to RE-ENTER their passphrase.
          const r=await ownerRequest('decide',{consentId:c.consentId,decision});
          if (!r?.ok) return;
          div.remove();ownerEntries=ownerEntries.filter(x=>x.consentId!==c.consentId);
          ownerMessage('Решение принято: ' + labels[decision] + '. Запрос одноразовый.');
          // Only resume a GUI action directly initiated in THIS widget; never
          // consume unrelated ChatGPT-agent or historical pending approvals.
          if (touchConsent && c.consentId===touchConsent.consentId && c.target===touchConsent.target) {
            const pendingTouch=touchConsent; touchConsent=null;
            try {
              const done=await callTool('confirm_action',{consentId:pendingTouch.consentId,decision,target:pendingTouch.target});
              if (done?.isError) throw Error('Host не принял завершение действия');
              touchMessage('Решение передано Host. Проверь экран Windows.');
            } catch(e) {touchMessage('Подтверждение принято, но исполнение не подтверждено: '+String(e.message||e));}
          }
          dismissOwnerPopup();
        };
        actions.appendChild(b);
      }
      div.appendChild(actions);el.appendChild(div);
    }
    size();
  }
  $('owner-form').onsubmit=async e=>{
    e.preventDefault();
    const r=await ownerRequest('list');
    if (r && Array.isArray(r.pending)) {ownerEntries=r.pending;renderOwnerEntries();}
  };

  // NEXUS Live v4 — durable owner preference, automatic stale-read recovery,
  // native Android text input, and intentional one/double tap gestures.
  // Permission remains enforced by Host GUI policy for every tool call.
  let leaseTimer=null, leaseUntil=0;
  function touchMessage(message) {
    const el=$('touch-mini');el.hidden=false;
    el.textContent=String(message).slice(0,145);
    clearTimeout(lastStatusTimer);
    lastStatusTimer=setTimeout(()=>{if(!touchBusy)el.hidden=true;},6000);
    size();
  }
  function hideComposer() {
    $('touch-tools').hidden=true;
    $('touch-text').blur();
    size();
  }
  function showComposer() {
    if (!touchEnabled || paused || stopped || ownerPopup) return;
    $('touch-tools').hidden=false;
    size();
    // Real native Android keyboard is attached to this ordinary HTML input.
    // If Android requires a fresh user gesture, tapping the field will open it.
    try {$('touch-text').focus({preventScroll:true});}catch{}
  }
  function setTouchVisual(enabled) {
    touchEnabled=enabled===true;
    $('img').classList.toggle('touchable',touchEnabled);
    $('touch-toggle').textContent=touchEnabled?'Управление: вкл.':'Управление: выкл.';
    $('touch-toggle').setAttribute('aria-pressed',String(touchEnabled));
    $('touch-open').hidden=!touchEnabled;
    if (!touchEnabled) hideComposer();
    size();
  }
  function clearTap() {
    clearTimeout(tapTimer);tapTimer=null;lastTap=null;pointerStart=null;
  }
  function resetTouch() {
    clearTap();setTouchVisual(false);
    $('touch-text').value='';
    leaseUntil=0;
  }
  async function loadOwnerPreference() {
    try {
      const r=await callTool('owner_ui_pref',{action:'get'});
      if (r?.isError || typeof r?.structuredContent?.enabled!=='boolean') throw Error('owner_ui_pref_unavailable');
      if (!stopped) {
        setTouchVisual(r.structuredContent.enabled);
        if (touchEnabled) leaseUntil=Date.now()+10*60*1000;
      }
    } catch {
      // Older Host: never pretend persistence works and never silently enable input.
      setTouchVisual(false);
      touchMessage('Настройка управления требует обновлённого NEXUS Host.');
    }
  }
  function touchReady() {
    return touchEnabled && !paused && !stopped && !ownerPopup && !touchBusy &&
      document.visibilityState!=='hidden' && frameGeometry &&
      lastAt>0 && Date.now()-lastAt<5000 && !!$('img').getAttribute('src');
  }
  const toolFailure = r => r?.isError ? String(r.content?.[0]?.text||'Host отклонил действие') : '';
  function staleRefusal(msg) {
    // A stale_args Host rejection occurs BEFORE the desktop action.
    // No other errors, including timeouts and screen_changed_retry, are retried.
    return /(?:^|\\b)stale_args:\\s*(?:task_resumed|owner_stop_resumed|owner_pause_resumed)/i.test(String(msg));
  }
  async function reobserveFreshFrame(geometry, gestureAt) {
    if (!touchEnabled || stopped || paused || ownerPopup || Date.now()-gestureAt>8000) throw Error('Касание устарело. Ничего не отправлено.');
    const w=await callTool('list_windows',{includeTitles:false});
    if (!w || toolFailure(w)) throw Error('Не удалось обновить окна. Действие отменено.');
    const f=await callTool('live_frame',{maxWidth:mode==='fullscreen'?1600:960,quality:60});
    const sc=f?.structuredContent;
    if (!sc || toolFailure(f) || sc.state!=='live' ||
        !Number.isFinite(sc.screenW) || !Number.isFinite(sc.screenH) ||
        sc.screenW!==geometry.screenW || sc.screenH!==geometry.screenH ||
        !Array.isArray(f.content) || !f.content.some(c=>c.type==='image'))
      throw Error('Экран изменился или недоступен. Действие отменено.');
    if (!touchEnabled || stopped || paused || ownerPopup || Date.now()-gestureAt>8000) throw Error('Касание устарело. Действие отменено.');
    const im=f.content.find(c=>c.type==='image');
    $('img').src='data:'+im.mimeType+';base64,'+im.data;
    frameGeometry={screenW:sc.screenW,screenH:sc.screenH,imageW:sc.imageW,imageH:sc.imageH};
    lastAt=Date.now();lastSeq=sc.seq;
  }
  async function touchCall(name,args) {
    if (!touchReady()) {touchMessage('Нет свежего кадра или управление выключено.');return null;}
    touchBusy=true;
    const geometry={...frameGeometry}, gestureAt=Date.now();
    leaseUntil=Date.now()+10*60*1000;
    try {
      const send=async()=>{
        const r=await callTool(name,args);
        const fail=toolFailure(r);
        if (fail)throw Error(fail);
        return r;
      };
      let r;
      try {r=await send();}
      catch(e) {
        if (!staleRefusal(e?.message)) throw e;
        touchMessage('NEXUS обновляет экран…');
        await reobserveFreshFrame(geometry,gestureAt);
        // Exactly ONE repeat after a proven pre-execution stale refusal.
        // No retries for an unknown outcome or any other error.
        r=await send();
      }
      const sc=r?.structuredContent||{};
      const status=String(sc.status||'');
      if (status==='consent_required' || status==='owner_approval_pending') {
        touchConsent=/^[a-f0-9]{12}$/.test(String(sc.consentId||''))&&typeof sc.target==='string'
          ? {consentId:sc.consentId,target:sc.target}:null;
        touchMessage('Требуется разрешение владельца.');
        showOwnerPopup(Math.max(1,pendingCount));
        return sc;
      }
      if (sc.done===true) {
        touchMessage('Выполнено на ПК.');
        if (name==='mouse_action' && sc.action==='click' && touchEnabled &&
            /(?:Edit|Document|ComboBox)/i.test(String(sc.target?.control||'')) &&
            !/(?:password|пароль|pin|код безопасности|otp|cvv)/i.test(String(sc.target?.name||'')))
          showComposer();
        return sc;
      }
      touchMessage(status?'Ответ NEXUS: '+status:'Действие ещё не подтверждено.');
      return sc;
    } catch(e) {
      const message=String(e.message||e);
      touchMessage(staleRefusal(message)?'Экран требует обновления. Касание отменено.'
        : /owner_paused|stopped_by_owner/.test(message)?'Управление остановлено владельцем.'
        : /screen_changed_retry/.test(message)?'Экран изменился. Касание отменено.'
        : /timeout|pc_offline/.test(message)?'Нет ответа NEXUS. Повторять действие автоматически нельзя.'
        : 'Действие не выполнено: '+message.slice(0,72));
      return null;
    } finally {touchBusy=false;}
  }
  async function changeOwnerTouch(enabled) {
    if (touchBusy) return;
    $('touch-toggle').disabled=true;
    try {
      const r=await callTool('owner_ui_pref',{action:'set',enabled});
      if (!r || toolFailure(r) || r.structuredContent?.enabled!==enabled) throw Error('Host не сохранил настройку');
      clearTap();setTouchVisual(enabled);
      if(enabled)leaseUntil=Date.now()+10*60*1000;
      else leaseUntil=0;
      touchMessage(enabled?'Управление включено и сохранено на NEXUS Host.':'Управление выключено.');
    } catch(e) {touchMessage('Настройка не применена: '+String(e.message||e).slice(0,80));}
    finally {$('touch-toggle').disabled=false;}
  }
  $('touch-toggle').onclick=()=>changeOwnerTouch(!touchEnabled);
  $('touch-open').onclick=()=>showComposer();
  $('touch-close').onclick=hideComposer;
  $('touch-tools').addEventListener('pointerdown',e=>{if(e.target===$('touch-tools'))hideComposer();});
  $('img').addEventListener('pointerdown',e=>{
    pointerStart=touchEnabled && e.isTrusted && e.button===0 && !paused && !stopped ?
      {id:e.pointerId,x:e.clientX,y:e.clientY,at:Date.now()}:null;
  });
  $('img').addEventListener('pointercancel',()=>{pointerStart=null;});
  $('img').addEventListener('pointerup',e=>{
    const start=pointerStart;pointerStart=null;
    if (!start || start.id!==e.pointerId || Math.abs(e.clientX-start.x)>12 ||
        Math.abs(e.clientY-start.y)>12 || Date.now()-start.at>900 || !touchReady()) return;
    const point=framePointToScreen(e.clientX,e.clientY,$('img').getBoundingClientRect(),frameGeometry);
    if (!point) {touchMessage('Касание вне изображения.');return;}
    leaseUntil=Date.now()+10*60*1000;
    // Defer an ordinary single click briefly so a double tap emits EXACTLY one
    // double_click instead of a single_click + double_click triple activation.
    const prior=lastTap;
    if (prior && Date.now()-prior.at<=330 &&
        Math.hypot(point.x-prior.x,point.y-prior.y)<=40) {
      clearTimeout(tapTimer);tapTimer=null;lastTap=null;
      touchCall('mouse_action',{action:'double_click',x:point.x,y:point.y});
    } else {
      clearTap();
      lastTap={x:point.x,y:point.y,at:Date.now()};
      tapTimer=setTimeout(()=>{
        const tap=lastTap;tapTimer=null;lastTap=null;
        if(tap)touchCall('mouse_action',{action:'click',x:tap.x,y:tap.y});
      },340);
    }
  });
  $('touch-form').onsubmit=async e=>{
    e.preventDefault();
    const el=$('touch-text'),value=el.value;
    if (!value || value.length>500) return;
    if (!touchReady()) {touchMessage('Нет свежего экрана. Текст не отправлен.');return;}
    const result=await touchCall('keyboard_action',{text:value});
    if(result?.done===true){el.value='';hideComposer();}
    // Keep the draft if the result is unknown; never blindly repeat typed text.
  };
  for (const b of document.querySelectorAll('[data-touch-key]')) b.onclick=async()=>{
    const result=await touchCall('keyboard_action',{keys:b.getAttribute('data-touch-key')});
    if (result?.done===true && b.getAttribute('data-touch-key')==='esc')hideComposer();
  };
  function ownerLeaseLoop() {
    clearTimeout(leaseTimer);
    leaseTimer=setTimeout(async()=>{
      if (!stopped && !paused && touchEnabled && document.visibilityState==='visible' && Date.now()<leaseUntil) {
        try {
          const r=await callTool('get_capabilities',{});
          if (r?.isError || r?.structuredContent?.state==='owner_stop') resetTouch();
        } catch { /* no hidden retries, normal lease will safely expire */ }
      }
      if(!stopped)ownerLeaseLoop();
    },20000);
  }

  $('pp').onclick = () => { paused = !paused; $('pp').textContent = paused ? '▶' : '⏸'; if (paused) { halt(); setState('paused', 'ПАУЗА · кадры не запрашиваются'); } else { stopped = false; tick(); } };
  $('fps').onchange = () => schedule(0);
  $('pip').onclick = () => displayMode('pip');
  $('full').onclick = () => displayMode(mode === 'fullscreen' ? 'inline' : 'fullscreen');
  $('stop').onclick = async () => {
    stopped = true; frameGeometry=null; touchConsent=null; resetTouch(); halt(); clearTimeout(bootTimer); clearTimeout(ownerAlertTimer); dismissOwnerPopup(); $('img').removeAttribute('src');
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
        rpc('ui/initialize', {appInfo: {name: 'nexus-live-view', version: '4.0.0-touch'}, appCapabilities: {availableDisplayModes: ['inline', 'pip', 'fullscreen']}, protocolVersion: '2026-01-26'}),
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
    checkBootStatus();
    bootSchedule();
    checkOwnerAlerts();
    scheduleOwnerAlerts();
  })();
})();
</script></body></html>`;

/** resources/list + resources/read payloads (MCP Apps + legacy OpenAI keys). No external origins are allowed. */
export const WIDGET_RESOURCE = {uri: LIVE_UI, name: 'NEXUS Live View', description: 'Live view of the owner\'s Windows screen; owner-only approvals require direct NEXUS reauthentication.', mimeType: WIDGET_MIME};
export function widgetContents(uri = LIVE_UI) {
  const csp = {connectDomains: ['https://nexus-gateway.entoni441.workers.dev'], resourceDomains: [], frameDomains: []};
  return [{uri, mimeType: WIDGET_MIME, text: WIDGET_HTML,
    _meta: {ui: {csp, prefersBorder: true}, 'openai/widgetCSP': {connect_domains: ['https://nexus-gateway.entoni441.workers.dev'], resource_domains: []}, 'openai/widgetPrefersBorder': true,
      'openai/widgetDescription': 'Live view of the owner\'s Windows screen. Owner approvals require separate NEXUS passphrase; STOP switches the stream off at the PC.'}}];
}
