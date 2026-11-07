import test from 'node:test';
import assert from 'node:assert/strict';
import {WIDGET_HTML} from '../src/widget.mjs';

test('NX-WM-01: owner has explicit universal minimize panel, not a shell-close control',()=>{
 assert.match(WIDGET_HTML,/id="window-open"/);
 assert.match(WIDGET_HTML,/id="window-panel" hidden role="dialog"/);
 assert.match(WIDGET_HTML,/id="window-select"/);
 assert.match(WIDGET_HTML,/id="window-minimize"/);
 assert.match(WIDGET_HTML,/Свернуть выбранное/);
 assert.doesNotMatch(WIDGET_HTML,/callTool\('close_window'.*window-minimize/);
});
test('NX-WM-02: never minimize from stale PID or ambiguous title',()=>{
 const wm=WIDGET_HTML.slice(WIDGET_HTML.indexOf('OWNER WINDOW MANAGEMENT'),WIDGET_HTML.indexOf('PRELOGON-STATUS'));
 assert.match(wm,/callTool\('list_windows',\{includeTitles:true\}\)/);
 assert.match(wm,/matching\.length!==1/);
 assert.match(wm,/w\?\.pid===target\.pid&&w\?\.process===target\.process&&w\?\.title===target\.title/);
 assert.match(wm,/callTool\('minimize_window',\{pid:target\.pid,title:target\.title,ownerRequested:true\}\)/);
 assert.match(wm,/sc\.verified!==true/);
 assert.match(wm,/sc\.shellInputSent!==false/);
 assert.doesNotMatch(wm,/callTool\('mouse_action'|callTool\('keyboard_action'|callTool\('run_command'/);
 assert.doesNotMatch(wm,/\.click\(\)|\.dispatchEvent\(/);
});
test('NX-WM-03: window picker never opens after STOP or without owner touch preference',()=>{
 const wm=WIDGET_HTML.slice(WIDGET_HTML.indexOf('OWNER WINDOW MANAGEMENT'),WIDGET_HTML.indexOf('PRELOGON-STATUS'));
 assert.match(wm,/if\(stopped\)/);
 assert.match(wm,/if\(!touchEnabled\)/);
 assert.match(WIDGET_HTML,/stopped = true;closeWindowManager\(\)/);
 assert.match(WIDGET_HTML,/ownerRequested:true/);
 const js=WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js);
 assert.doesNotThrow(()=>new Function(js));
});
