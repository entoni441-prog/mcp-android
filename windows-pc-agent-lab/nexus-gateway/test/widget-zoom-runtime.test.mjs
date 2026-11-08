import test from 'node:test';
import assert from 'node:assert/strict';
import {WIDGET_HTML} from '../src/widget.mjs';

test('inline Live pointer gestures zoom and pan without dispatching a Windows tool call',()=>{
  const listeners={};const elements=new Map();const posted=[];
  const viewport={left:0,top:0,width:320,height:180,right:320,bottom:180};
  function element(id) {
    if(elements.has(id))return elements.get(id);
    const el={hidden:false,style:{},value:'',textContent:'',attributes:{},handlers:{},
      classList:{add(){},remove(){},toggle(){}},
      setAttribute(k,v){this.attributes[k]=String(v);},
      getAttribute(k){return this.attributes[k]??null;},
      removeAttribute(k){delete this.attributes[k];},
      addEventListener(t,fn){this.handlers[t]=fn;},
      focus(){},blur(){},setPointerCapture(){},releasePointerCapture(){},
      offsetWidth:320,offsetHeight:180,clientWidth:320,clientHeight:180,
      getBoundingClientRect(){
        if(id==='view')return viewport;
        if(id!=='img')return {left:0,top:0,width:320,height:180,right:320,bottom:180};
        const transform=this.style.transform||'';
        const pan=transform.match(/translate3d\(([-.\d]+)px,([-.\d]+)px,0\)/);
        const zoom=transform.match(/scale\(([-.\d]+)\)/);
        const z=zoom?Number(zoom[1]):1,px=pan?Number(pan[1]):0,py=pan?Number(pan[2]):0;
        const left=(320-320*z)/2+px,top=(180-180*z)/2+py;
        return {left,top,width:320*z,height:180*z,right:left+320*z,bottom:top+180*z};
      }
    };
    elements.set(id,el);return el;
  }
  const document={
    getElementById:element,querySelectorAll:()=>[],visibilityState:'visible',
    addEventListener(){},
    documentElement:{getBoundingClientRect:()=>({height:500})},
    body:{classList:{toggle(){},add(){},remove(){}},className:''}
  };
  const parent={postMessage:msg=>posted.push(msg)};
  const window={parent,addEventListener:(name,fn)=>{listeners[name]=fn;}};
  const script=WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  new Function('document','window','setTimeout','clearTimeout','URL',script)(
    document,window,()=>1,()=>{}, {revokeObjectURL(){}}
  );
  const viewer=element('view');
  const emit=(type,id,x,y)=>viewer.handlers[type]({
    isTrusted:true,pointerType:'touch',button:0,pointerId:id,clientX:x,clientY:y
  });
  // Two pointers: change their distance from 100 to 150 CSS pixels.
  emit('pointerdown',1,100,90);
  emit('pointerdown',2,200,90);
  emit('pointermove',2,250,90);
  assert.match(element('img').style.transform,/scale\(1\.5\)/);
  assert.equal(element('zoom-reset').hidden,false);
  emit('pointerup',2,250,90);emit('pointerup',1,100,90);
  assert.equal(posted.filter(x=>x.params?.name==='mouse_action').length,0);

  // At 1.5x, a one-finger slide pans the image, not the remote cursor.
  const prior=element('img').style.transform;
  emit('pointerdown',3,150,80);
  emit('pointermove',3,185,100);
  emit('pointerup',3,185,100);
  assert.notEqual(element('img').style.transform,prior);
  assert.equal(posted.filter(x=>x.params?.name==='mouse_action').length,0);

  element('zoom-reset').onclick();
  assert.match(element('img').style.transform,/scale\(1\)/);
  assert.equal(element('zoom-reset').hidden,true);
});
