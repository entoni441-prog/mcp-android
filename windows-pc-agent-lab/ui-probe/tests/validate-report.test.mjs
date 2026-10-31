import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUiReport } from '../validate-report.mjs';

const report = () => ({
  status:'ok', reason:'inspection_completed', mode:'local_read_only',
  app:'notepad',
  metadata:{
    observedControls:2, truncated:false,
    controls:[
      {controlType:'ControlType.Pane',automationId:'root',isEnabled:true},
      {controlType:'ControlType.Button',automationId:'SaveButton',isEnabled:false}
    ]
  }
});
const parse=x=>validateUiReport(JSON.stringify(x));
const refuses=x=>assert.throws(()=>parse(x),/invalid_uia_report/);

test('valid UIA report passes without copying arbitrary objects',()=>{
  const valid=report();
  const checked=parse(valid);
  assert.deepEqual(checked,valid);
  assert.equal(Object.isFrozen(checked),true);
  assert.equal(Object.isFrozen(checked.metadata.controls[0]),true);
});

test('local denial is accepted only as null metadata',()=>{
  assert.deepEqual(parse({
    status:'blocked',reason:'explicit_local_consent_required',
    mode:'local_read_only',app:'calculator',metadata:null
  }),{
    status:'blocked',reason:'explicit_local_consent_required',
    mode:'local_read_only',app:'calculator',metadata:null
  });
  refuses({
    status:'blocked',reason:'explicit_local_consent_required',
    mode:'local_read_only',app:'calculator',metadata:{data:'secret'}
  });
});

test('schema rejects arbitrary actions, remote claims, extra text and sensitive values',()=>{
  const edits=[
    {status:'executed'},
    {app:'browser'},
    {mode:'remote'},
    {reason:'inspection_completed',secret:'private'},
    {metadata:{...report().metadata, title:'Untitled - Password.txt'}},
    {metadata:{...report().metadata, controls:[{...report().metadata.controls[0],text:'secret'},report().metadata.controls[1]]}},
    {metadata:{...report().metadata,controls:[{...report().metadata.controls[0],controlType:'ControlType.Button; DROP TABLE;'}, report().metadata.controls[1]]}},
    {metadata:{...report().metadata,controls:[{...report().metadata.controls[0],automationId:'Secret:token'},report().metadata.controls[1]]}},
    {metadata:{...report().metadata,controls:[{...report().metadata.controls[0],isEnabled:'true'},report().metadata.controls[1]]}},
    {metadata:{...report().metadata,observedControls:40}},
  ];
  for(const edit of edits)refuses({...report(),...edit});
});

test('fail closed on oversize, null, array and prototype related fields',()=>{
  assert.throws(()=>validateUiReport('{invalid'),/invalid_uia_report/);
  assert.throws(()=>validateUiReport('X'.repeat(16385)),/invalid_uia_report/);
  assert.throws(()=>validateUiReport(null),/invalid_uia_report/);
  assert.throws(()=>validateUiReport('[]'),/invalid_uia_report/);
  const poisoned=JSON.parse('{"status":"ok","reason":"inspection_completed","mode":"local_read_only","app":"notepad","metadata":{"observedControls":0,"truncated":false,"controls":[]},"__proto__":{"admin":true}}');
  refuses(poisoned);
});

test('rejects incorrect control lengths and mismatched counts',()=>{
  const bad=report();
  bad.metadata.controls=Array.from({length:41},()=>({
    controlType:'ControlType.Pane',automationId:'x',isEnabled:true
  }));
  bad.metadata.observedControls=41;
  refuses(bad);
  const another=report();
  another.metadata.controls[0].automationId='a'.repeat(49);
  refuses(another);
});

test('does not require a network connection',()=>{
  const valid=parse(report());
  assert.equal(valid.status,'ok');
  assert.equal(valid.metadata.controls[0].controlType,'ControlType.Pane');
});
