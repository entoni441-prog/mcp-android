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
  assert.match(WIDGET_HTML,/el\.value=''; \/\/ no secret persistence/);
  assert.match(WIDGET_HTML,/touchCall\('keyboard_action',\{text:value\}\)/);
  assert.match(WIDGET_HTML,/Не вводи PIN, пароли/);
  const src=WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(src);
  assert.doesNotThrow(()=>new Function(src));
  assert.equal(widgetContents()[0]._meta.ui.csp.connectDomains.length,1);
});
