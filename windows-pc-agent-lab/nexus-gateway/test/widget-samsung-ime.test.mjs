import test from 'node:test';
import assert from 'node:assert/strict';
import {planImeSuffixEdit} from '../src/widget-input.mjs';
import {WIDGET_HTML, LIVE_UI} from '../src/widget.mjs';

test('IME suffix planner: unicode, autocorrect, backspace, and unsafe mid-edit refusal',()=>{
  assert.deepEqual(planImeSuffixEdit('','Привет'),[{text:'Привет'}]);
  assert.deepEqual(planImeSuffixEdit('те','тебе'),[{text:'бе'}]);
  assert.deepEqual(planImeSuffixEdit('ab','a'),[{keys:'backspace'}]);
  assert.deepEqual(planImeSuffixEdit('teh','the'),[
    {keys:'backspace'},{keys:'backspace'},{text:'he'}
  ]);
  assert.deepEqual(planImeSuffixEdit('x','x'),[]);
  assert.equal(planImeSuffixEdit('hello','world',false),null);
  assert.equal(planImeSuffixEdit('','x'.repeat(2001)),null);
  assert.equal(planImeSuffixEdit('x'.repeat(100),'y'),null);
});

function makeWidget(){
  const timers=new Map(),elMap=new Map(),listeners={},calls=[];
  let seq=0,editable=true,keyboardResult=true;
  const setTimeout=(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;};
  const clearTimeout=id=>timers.delete(id);
  function elem(id){
    if(elMap.has(id))return elMap.get(id);
    const o={hidden:false,style:{},value:'',textContent:'',selectionStart:0,focusCount:0,attrs:{},handlers:{},
      classList:{add(){},remove(){},toggle(){}},
      setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},
      getAttribute(k){return this.attrs[k]??null;},
      addEventListener(k,fn){this.handlers[k]=fn;},
      focus(){this.focusCount++;},blur(){},
      setPointerCapture(){},releasePointerCapture(){},
      clientWidth:320,clientHeight:180,offsetWidth:320,offsetHeight:180,
      getBoundingClientRect(){return {left:0,top:0,width:320,height:180,right:320,bottom:180};}
    };
    elMap.set(id,o);return o;
  }
  const document={
    getElementById:elem,querySelectorAll:()=>[],visibilityState:'visible',
    addEventListener(){},documentElement:{getBoundingClientRect:()=>({height:500})},
    body:{classList:{toggle(){},add(){},remove(){}},className:''}
  };
  const parent={postMessage(m){
    if(m.method!=='tools/call')return;
    calls.push(m.params);
    const isMouse=m.params.name==='mouse_action';
    const sc=isMouse?{done:true,action:'click',target:{
      process:'Notepad',control:editable?'ControlType.Document':'ControlType.Button',
      isPassword:editable?false:true,name:editable?'Editor':'Password'}}:
      {done:keyboardResult,target:'Notepad'};
    Promise.resolve().then(()=>listeners.message({
      source:parent,data:{jsonrpc:'2.0',id:m.id,result:{structuredContent:sc}}
    }));
  }};
  const window={parent,addEventListener:(n,fn)=>{listeners[n]=fn;}};
  let js=WIDGET_HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(js);
  const hook="  const viewer=$('view');";
  assert.ok(js.includes(hook));
  js=js.replace(hook,`  host={};touchEnabled=true;paused=false;stopped=false;lastAt=Date.now();
    frameGeometry={screenW:1280,screenH:720,imageW:960,imageH:540};
    $('img').setAttribute('src','mock-live');
    window.__sendTouch=touchCall;
    ${hook}`);
  new Function('document','window','setTimeout','clearTimeout','URL',js)(
    document,window,setTimeout,clearTimeout,{revokeObjectURL(){}}
  );
  async function open(){
    return window.__sendTouch('mouse_action',{action:'click',x:600,y:400});
  }
  async function fire(ms){
    for(let pass=0;pass<5;pass++){
      const ids=[...timers.entries()].filter(([id,x])=>x.ms===ms).map(([id])=>id);
      if(!ids.length)break;
      for(const id of ids){
        const job=timers.get(id);if(!job)continue;timers.delete(id);
        await job.fn();await Promise.resolve();
      }
    }
  }
  function input(value,type='insertText'){
    const e=elem('touch-text');e.value=value;e.selectionStart=value.length;
    e.handlers.input?.({inputType:type,isComposing:false});
  }
  function keypress(key){
    const e=elem('touch-text');
    e.handlers.keydown?.({key,preventDefault(){}});
  }
  function beforeinput(type){
    const e=elem('touch-text');
    e.handlers.beforeinput?.({inputType:type,preventDefault(){}});
  }
  return {open,fire,input,keypress,beforeinput,elem,calls,
    setEditable:v=>{editable=v;},
    setKeyboardResult:v=>{keyboardResult=v;}};
}

test('verified Notepad editor tap opens Samsung keyboard automatically and streams text without Send',async()=>{
  const t=makeWidget();
  assert.equal(t.elem('touch-tools').hidden,false); // mock starts visible but no IME active
  await t.open();
  assert.ok(t.elem('touch-text').focusCount>0);
  assert.equal(t.elem('touch-tools').hidden,false);
  t.input('П');t.input('Пр');t.input('При');
  await t.fire(130);
  const sent=t.calls.filter(x=>x.name==='keyboard_action');
  assert.deepEqual(sent.map(x=>x.arguments),[{text:'При'}]);
});

test('iPhone fallback opens native keyboard in an explicit synchronous tap, no second Windows action',async()=>{
  const t=makeWidget();await t.open();
  const box=t.elem('touch-text');
  const first=box.focusCount, remoteCalls=t.calls.length;
  assert.equal(t.elem('touch-open').hidden,false);
  t.elem('touch-open').onclick();
  assert.equal(box.focusCount,first+1);
  assert.equal(t.calls.length,remoteCalls,'local focus never sends a new mouse/keyboard RPC');
});

test('PIN or password never opens the model-mediated text channel on iPhone',async()=>{
  const t=makeWidget();t.setEditable(false);await t.open();
  assert.equal(t.elem('touch-open').hidden,true);
  assert.match(t.elem('touch-mini').textContent,/PIN\/пароль/);
  t.elem('touch-open').onclick();
  t.input('85764412');await t.fire(130);
  assert.equal(t.calls.filter(x=>x.name==='keyboard_action').length,0);
});

test('IME backspace and predictive replacement apply only a suffix at remote caret',async()=>{
  const t=makeWidget();await t.open();
  t.input('teh');await t.fire(130);
  t.input('the');await t.fire(130);
  t.input('th','deleteContentBackward');await t.fire(130);
  assert.deepEqual(t.calls.filter(x=>x.name==='keyboard_action').map(x=>x.arguments),[
    {text:'teh'},{keys:'backspace'},{keys:'backspace'},{text:'he'},{keys:'backspace'}
  ]);
});

test('Samsung Backspace works even after proxy buffer is empty',async()=>{
  const t=makeWidget();await t.open();
  t.beforeinput('deleteContentBackward');t.input('','deleteContentBackward');
  await t.fire(130);
  assert.deepEqual(t.calls.filter(x=>x.name==='keyboard_action').map(x=>x.arguments),
    [{keys:'backspace'}]);
});

test('password or unknown input is rejected; no Android typing forwarded',async()=>{
  const t=makeWidget();t.setEditable(false);await t.open();
  t.input('never-send-this');await t.fire(130);
  assert.equal(t.calls.filter(x=>x.name==='keyboard_action').length,0);
  assert.equal(t.elem('touch-tools').hidden,true);
});

test('unknown Host keyboard result stops queue without retrying text',async()=>{
  const t=makeWidget();await t.open();
  t.setKeyboardResult(false);
  t.input('A');await t.fire(130);
  t.input('AB');await t.fire(130);
  assert.equal(t.calls.filter(x=>x.name==='keyboard_action').length,1);
});

test('new MCP Apps URI avoids old cached v10 text-entry card',()=>{
  assert.equal(LIVE_UI,'ui://nexus/live-view-v11.html');
  assert.match(WIDGET_HTML,/compositionend/);
  assert.match(WIDGET_HTML,/function flushIme/);
  assert.match(WIDGET_HTML,/keyboard_action',op/);
  assert.doesNotMatch(WIDGET_HTML,/touchCall\('keyboard_action',\{text:value\}\)/);
});
