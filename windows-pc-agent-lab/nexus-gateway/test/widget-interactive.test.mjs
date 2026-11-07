import test from 'node:test';
import assert from 'node:assert/strict';
import {WIDGET_HTML,widgetContents} from '../src/widget.mjs';

test('Live 2.0: genuine opt-in, no touch before owner activation',()=>{
  assert.match(WIDGET_HTML,/id="touch-toggle"[^>]*aria-pressed="false"/);
  assert.match(WIDGET_HTML,/let frameGeometry=null, touchEnabled=false/);
  assert.match(WIDGET_HTML,/Date\.now\(\)-lastAt<5000/);
  assert.match(WIDGET_HTML,/framePointToScreen\(e\.clientX,e\.clientY/);
  assert.match(WIDGET_HTML,/touchCall\('mouse_action',\{action:'click'/);
  assert.match(WIDGET_HTML,/pointerStart/);
});
test('Live 2.0: popup follows nonsecret count only, passphrase stays direct to Gateway',()=>{
  assert.match(WIDGET_HTML,/function showOwnerPopup\(count\)/);
  assert.match(WIDGET_HTML,/function dismissOwnerPopup\(\)/);
  assert.match(WIDGET_HTML,/callTool\('host_diagnostics',\{\}\)/);
  assert.match(WIDGET_HTML,/pendingConsents/);
  assert.match(WIDGET_HTML,/if \(ownerPopup\) dismissOwnerPopup\(\)/);
  assert.match(WIDGET_HTML,/ownerPost\('\/live\/widget\/perform'/);
  assert.doesNotMatch(WIDGET_HTML,/callTool\('owner_decide'/);
  assert.doesNotMatch(WIDGET_HTML,/localStorage|sessionStorage/);
  assert.doesNotMatch(WIDGET_HTML,/<input[^>]+(?:PIN Windows|Пароль Windows)/i);
});
test('Live 2.0: text is manual, explicitly nonsecret, and no credentials recorded',()=>{
  assert.match(WIDGET_HTML,/id="touch-text"[^>]*type="text"/);
  assert.match(WIDGET_HTML,/if\(result\?\.done===true\)\{el\.value='';hideComposer\(\);\}/);
  assert.match(WIDGET_HTML,/touchCall\('keyboard_action',\{text:value\}\)/);
  assert.match(WIDGET_HTML,/Не вводи PIN, пароль/);
  const src=WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(src);
  assert.doesNotThrow(()=>new Function(src));
  assert.equal(widgetContents()[0]._meta.ui.csp.connectDomains.length,1);
});

test('Live v3: mobile status and owner confirmations collapse by default',()=>{
  assert.match(WIDGET_HTML,/id="boot-hint" hidden/);
  assert.match(WIDGET_HTML,/id="boot-toggle"[^>]*aria-expanded="false"/);
  assert.match(WIDGET_HTML,/id="owner-panel" hidden/);
  assert.match(WIDGET_HTML,/id="owner-toggle"[^>]*aria-expanded="false"/);
  assert.match(WIDGET_HTML,/function dismissOwnerPopup\(\)/);
  assert.match(WIDGET_HTML,/if \(count===0\) \{/);
  assert.match(WIDGET_HTML,/ownerPanel\.hidden=true/);
  assert.match(WIDGET_HTML,/#owner-panel\[hidden\]/);
});
test('Live v3: failed embedded owner fetch does not approve or hide recovery URL',()=>{
  assert.match(WIDGET_HTML,/id="owner-fallback"[^>]*href="https:\/\/nexus-gateway\.entoni441\.workers\.dev\/live"/);
  assert.match(WIDGET_HTML,/Failed to fetch\|NetworkError\|Load failed/);
  assert.match(WIDGET_HTML,/Действие не подтверждено/);
  assert.match(WIDGET_HTML,/\$\('owner-fallback'\)\.hidden=!transport/);
  assert.doesNotMatch(WIDGET_HTML,/callTool\('owner_decide'/);
});

test('Live v3: STOP stays clickable above the approval overlay',()=>{
  assert.match(WIDGET_HTML,/\.bar\{position:relative;z-index:110\}/);
  assert.match(WIDGET_HTML,/\.owner\.is-popup\{position:fixed;inset:0;z-index:100/);
  assert.match(WIDGET_HTML,/id="stop" class="stop"/);
});

test('Live v4: one Host-side preference, STOP disarms, no browser storage',()=>{
  assert.match(WIDGET_HTML,/callTool\('owner_ui_pref',\{action:'get'\}\)/);
  assert.match(WIDGET_HTML,/callTool\('owner_ui_pref',\{action:'set',enabled\}\)/);
  assert.match(WIDGET_HTML,/if\s*\(touchEnabled\)\s*leaseUntil=Date\.now\(\)\+10\*60\*1000/);
  assert.match(WIDGET_HTML,/function resetTouch\(\)/);
  assert.match(WIDGET_HTML,/clearTimeout\(leaseTimer\)/);
  assert.doesNotMatch(WIDGET_HTML,/localStorage|sessionStorage/);
});
test('Live v4: one or double tap, without triple sending',()=>{
  assert.match(WIDGET_HTML,/Date\.now\(\)-prior\.at<=330/);
  assert.match(WIDGET_HTML,/clearTimeout\(tapTimer\)/);
  assert.match(WIDGET_HTML,/action:'double_click'/);
  assert.match(WIDGET_HTML,/action:'click'/);
  assert.match(WIDGET_HTML,/\},340\)/);
});
test('Live v4: stale recovery is read-only and limited to proven nonexecution',()=>{
  assert.match(WIDGET_HTML,/stale_args:/);
  assert.match(WIDGET_HTML,/reobserveFreshFrame\(geometry,gestureAt\)/);
  assert.match(WIDGET_HTML,/callTool\('list_windows',\{includeTitles:false\}\)/);
  assert.match(WIDGET_HTML,/callTool\('live_frame',/);
  assert.match(WIDGET_HTML,/r=await send\(\)/);
  assert.match(WIDGET_HTML,/No retries for an unknown outcome/);
  assert.match(WIDGET_HTML,/sc\.screenW!==geometry\.screenW/);
});
test('Live v4: Samsung keyboard is a native mobile input inside a popup',()=>{
  assert.match(WIDGET_HTML,/id="touch-tools" hidden role="dialog"/);
  assert.match(WIDGET_HTML,/id="touch-text"[^>]*inputmode="text" enterkeyhint="send"/);
  assert.match(WIDGET_HTML,/function showComposer\(\)/);
  assert.match(WIDGET_HTML,/\$\('touch-text'\)\.focus/);
  assert.match(WIDGET_HTML,/function hideComposer\(\)/);
  assert.match(WIDGET_HTML,/if \(!touchEnabled\) hideComposer\(\)/);
});
