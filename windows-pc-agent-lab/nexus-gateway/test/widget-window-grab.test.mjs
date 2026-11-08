import test from 'node:test';
import assert from 'node:assert/strict';
import {WIDGET_HTML} from '../src/widget.mjs';

function widgetHarness(){
  const elements=new Map(),posted=[],timers=new Map(),handlers={};
  let sequence=0;
  function el(id){
    if(elements.has(id))return elements.get(id);
    const o={hidden:false,style:{},textContent:'',value:'',attrs:{},handlers:{},
      classList:{add(){},remove(){},toggle(){}},
      setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]??null;},
      removeAttribute(k){delete this.attrs[k];},
      addEventListener(k,fn){this.handlers[k]=fn;},
      setPointerCapture(){},releasePointerCapture(){},focus(){},blur(){},
      offsetWidth:320,offsetHeight:180,clientWidth:320,clientHeight:180,
      getBoundingClientRect(){return {left:0,top:0,width:320,height:180,right:320,bottom:180};}
    };
    elements.set(id,o);return o;
  }
  const document={getElementById:el,querySelectorAll:()=>[],
    visibilityState:'visible',addEventListener(){},
    documentElement:{getBoundingClientRect:()=>({height:480})},
    body:{classList:{toggle(){},add(){},remove(){}},className:''}};
  const window={parent:{postMessage:x=>posted.push(x)},addEventListener:(k,fn)=>{handlers[k]=fn;}};
  const timer=(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;};
  const clearTimer=id=>timers.delete(id);
  let js=WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(js);
  const needle="  const viewer=$('view');";
  assert.ok(js.includes(needle));
  js=js.replace(needle,`  host={};touchEnabled=true;paused=false;stopped=false;lastAt=Date.now();
    frameGeometry={screenW:1280,screenH:720,imageW:960,imageH:540};
    $('img').setAttribute('src','mock-frame');\n${needle}`);
  new Function('document','window','setTimeout','clearTimeout','URL',js)(
    document,window,timer,clearTimer,{revokeObjectURL(){}}
  );
  const viewer=el('view');
  function emit(type,id,x,y){
    assert.equal(typeof viewer.handlers[type],'function');
    viewer.handlers[type]({pointerId:id,clientX:x,clientY:y,pointerType:'touch',
      isTrusted:true,button:0});
  }
  return {el,posted,timers,emit};
}

test('long hold then drag emits a single Host drag, no image pan and no shell command',()=>{
  const h=widgetHarness();
  h.emit('pointerdown',1,120,60);
  const hold=[...h.timers.values()].find(x=>x.ms===500);
  assert.ok(hold,'500ms capture required');
  hold.fn();
  h.emit('pointermove',1,220,100);
  h.emit('pointerup',1,220,100);
  const calls=h.posted.filter(x=>x.method==='tools/call'&&x.params.name==='mouse_action');
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].params.arguments,
    {action:'drag',x:480,y:240,x2:880,y2:400});
  assert.equal(h.el('img').style.transform??'', '',
    'window move must not pan the zoom image');
});

test('ordinary immediate swipe does not create window drag',()=>{
  const h=widgetHarness();
  h.emit('pointerdown',1,120,60);
  h.emit('pointermove',1,175,90);
  h.emit('pointerup',1,175,90);
  const calls=h.posted.filter(x=>x.method==='tools/call'&&x.params.name==='mouse_action');
  assert.equal(calls.length,0);
});

test('multi-touch cancels an armed window hold without dragging',()=>{
  const h=widgetHarness();
  h.emit('pointerdown',1,120,60);
  const timer=[...h.timers.entries()].find(x=>x[1].ms===500);
  assert.ok(timer);
  h.emit('pointerdown',2,200,60);
  assert.equal(h.timers.has(timer[0]),false,'multi-touch cancels 500ms window hold');
  h.emit('pointerup',2,200,60);
  h.emit('pointerup',1,120,60);
  assert.equal(h.posted.filter(x=>x.method==='tools/call'&&x.params.name==='mouse_action').length,0);
});
