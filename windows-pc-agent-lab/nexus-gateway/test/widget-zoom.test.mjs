import test from 'node:test';
import assert from 'node:assert/strict';
import {anchoredZoomPan,clampZoomPan,framePointToScreen} from '../src/widget-input.mjs';
import {WIDGET_HTML} from '../src/widget.mjs';

const mid={x:160,y:90};

test('pinch anchored at finger midpoint keeps the same desktop pixel under the fingers',()=>{
  const p=anchoredZoomPan(1,0,0,2,200,100,200,100,mid.x,mid.y);
  assert.deepEqual(p,{panX:-40,panY:-10});
  const visualX=mid.x+p.panX+2*(200-mid.x);
  const visualY=mid.y+p.panY+2*(100-mid.y);
  assert.equal(visualX,200);
  assert.equal(visualY,100);
});

test('pinch combines scale and two-finger pan, without injecting a mouse action',()=>{
  assert.deepEqual(anchoredZoomPan(2,0,0,2,160,90,180,80,160,90),
    {panX:20,panY:-10});
  assert.equal(anchoredZoomPan(0,0,0,2,160,90,160,90,160,90),null);
  assert.equal(anchoredZoomPan(1,0,NaN,2,160,90,160,90,160,90),null);
});

test('pan is clamped inside the viewport; zoom 1 resets the pan',()=>{
  assert.deepEqual(clampZoomPan(2,400,-400,320,180,320,180),
    {panX:160,panY:-90});
  assert.deepEqual(clampZoomPan(1,20,-50,320,180,320,180),
    {panX:0,panY:0});
  assert.deepEqual(clampZoomPan(2,25,12,200,113,320,180),
    {panX:25,panY:12});
  assert.equal(clampZoomPan(1,0,0,0,0,320,180),null);
});

test('tap after CSS transform maps through the transformed DOMRect, not viewport',()=>{
  const frame={screenW:2560,screenH:1440,imageW:1600,imageH:900};
  const rect={left:-120,top:50,width:640,height:360};
  assert.deepEqual(framePointToScreen(200,230,rect,frame),{x:1280,y:720});
  assert.equal(framePointToScreen(520,230,rect,frame),null);
});

test('Live supports native pointer pinch and one-finger pan without remote mouse calls',()=>{
  assert.match(WIDGET_HTML,/id="view"[^>]*двумя пальцами/);
  assert.match(WIDGET_HTML,/touch-action:none/);
  assert.match(WIDGET_HTML,/id="zoom-reset"[^>]*hidden/);
  assert.match(WIDGET_HTML,/activePointers.size===2/);
  assert.match(WIDGET_HTML,/anchoredZoomPan\(origin\.scale/);
  assert.match(WIDGET_HTML,/zoomScale=scale;zoomPanX=next\.panX/);
  assert.match(WIDGET_HTML,/if\(multi\)\{[\s\S]*?return; \/\/ Never dispatch a Windows action/);
  assert.match(WIDGET_HTML,/start\.moved/);
  assert.match(WIDGET_HTML,/framePointToScreen\(e\.clientX,e\.clientY,\$\('img'\)\.getBoundingClientRect\(\),frameGeometry\)/);
  assert.match(WIDGET_HTML,/zoomScale>1\.01\?1600:960/);
  assert.doesNotMatch(WIDGET_HTML,/addEventListener\('pointerup',[\s\S]*?touchCall\('mouse_action',[\s\S]*?activePointers\.delete/);
});

test('pinch handlers run inside syntactically valid sandbox script',()=>{
  const src=WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(src);
  assert.doesNotThrow(()=>new Function(src));
});
