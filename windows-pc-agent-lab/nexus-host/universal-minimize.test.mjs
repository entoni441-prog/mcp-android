import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedWindowProcess,isTitlebarMinimizeTouch} from './policy.mjs';
const sample=(process='ApplicationFrameHost',name='Свернуть')=>({
 pid:123,process,controlType:'ControlType.Button',
 window:{pid:123,hwnd:5678,process,rect:{x:20,y:30,w:800,h:600}},
 elem:{name,id:'MinimizeButton',isPassword:false,rect:{x:700,y:35,w:40,h:32}}
});
test('normal app and frame hosts can be minimized, secure desktop cannot',()=>{
 for(const p of ['CalculatorApp','ApplicationFrameHost','WindowsTerminal','powershell','msedge','explorer','Code','SystemSettings'])
   assert.equal(allowedWindowProcess(p),true,p);
 for(const p of ['consent','LogonUI','winlogon','CredentialUIBroker','lsass','System','',null])
   assert.equal(allowedWindowProcess(p),false,String(p));
});
test('only a verified caption minimize button is converted to a window operation',()=>{
 const a=sample();
 assert.equal(isTitlebarMinimizeTouch(a,'click'),true);
 assert.equal(isTitlebarMinimizeTouch({...a,elem:{...a.elem,name:'Свернуть Калькулятор',id:'Minimize'}},'click'),true);
 assert.equal(isTitlebarMinimizeTouch({...a,elem:{...a.elem,name:'Minimize',id:''}},'click'),true);
 assert.equal(isTitlebarMinimizeTouch({...a,elem:{...a.elem,name:'Riduci a icona',id:''}},'click'),true);
 assert.equal(isTitlebarMinimizeTouch(a,'move'),false);
 assert.equal(isTitlebarMinimizeTouch({...a,window:{...a.window,process:'consent'}},'click'),false);
 assert.equal(isTitlebarMinimizeTouch({...a,elem:{...a.elem,name:'Close',id:''}},'click'),false);
 assert.equal(isTitlebarMinimizeTouch({...a,elem:{...a.elem,name:'Minimize',id:'',rect:{x:700,y:250,w:40,h:32}}},'click'),false);
 assert.equal(isTitlebarMinimizeTouch({...a,elem:{...a.elem,name:'Minimize',id:'',isPassword:true}},'click'),false);
 assert.equal(isTitlebarMinimizeTouch({...a,controlType:'ControlType.Edit'},'click'),false);
 assert.equal(isTitlebarMinimizeTouch({...a,window:{...a.window,hwnd:0}},'click'),false);
});
