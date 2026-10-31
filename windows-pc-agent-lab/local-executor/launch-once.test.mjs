import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseLocalCommand,launchOnce} from './launch-once.mjs';

const winEnv={
  LOCALAPPDATA:'C:\\Users\\TestUser\\AppData\\Local',
  SystemRoot:'C:\\Windows'
};

test('explicit consent and exact app selection required',()=>{
  assert.equal(parseLocalCommand(['--app=notepad','--approve-once']),'notepad');
  assert.equal(parseLocalCommand(['--approve-once','--app=calculator']),'calculator');
  for(const argv of [
    [],['--app=notepad'],['--approve-once'],['--app=powershell','--approve-once'],
    ['--app=notepad','--approve-once','--silent'],
    ['--app=notepad','--app=calculator'],['--app=notepad','--approve-once','--approve-once'],
    ['--app=notepad','--app=cmd.exe'],['--app=C:\\Windows\\System32\\cmd.exe','--approve-once']
  ])assert.throws(()=>parseLocalCommand(argv));
});

test('local Windows launch delegates ONLY approved app and fixed workspace',async()=>{
  const calls=[];
  const result=await launchOnce({
    argv:['--app=notepad','--approve-once'],
    platform:'win32',env:winEnv,
    executor:async(action,args,opts)=>{
      calls.push({action,args,opts});
      return {started:true,app:'notepad'};
    }
  });
  assert.deepEqual(result,{status:'spawn_confirmed',app:'notepad',mode:'local_foreground_one_shot'});
  assert.equal(calls.length,1);
  assert.equal(calls[0].action,'open_app');
  assert.deepEqual(calls[0].args,{app:'notepad'});
  assert.equal(calls[0].opts.workspace,
    path.win32.join(winEnv.LOCALAPPDATA,'PcAgentReadonlyLab','workspace'));
  assert.equal(calls[0].opts.systemRoot,'C:\\Windows');
});

test('deny non-Windows and invalid environment before any operation',async()=>{
  let count=0;
  const executor=async()=>{count++;return {started:true,app:'notepad'}};
  for(const config of [
    {platform:'linux',env:winEnv},
    {platform:'win32',env:{...winEnv,SystemRoot:'\\\\server\\share'}},
    {platform:'win32',env:{...winEnv,LOCALAPPDATA:'..\\relative'}},
    {platform:'win32',env:{...winEnv,SystemRoot:'C:\\Windows\\..\\other'}},
    {platform:'win32',env:{...winEnv,SystemRoot:''}}
  ])await assert.rejects(launchOnce({
    argv:['--app=notepad','--approve-once'],executor,...config
  }));
  assert.equal(count,0);
});

test('a failed launch cannot be reported as success',async()=>{
  await assert.rejects(launchOnce({
    argv:['--app=calculator','--approve-once'],platform:'win32',
    env:winEnv,executor:async()=>({started:false})
  }),/app_launch_unconfirmed/);
});

test('direct invocation without approval fails closed, with no actual launch',()=>{
  const output=spawnSync(process.execPath,[
    new URL('./launch-once.mjs',import.meta.url).pathname,'--app=notepad'
  ],{encoding:'utf8',timeout:10000});
  assert.equal(output.status,2);
  const obj=JSON.parse(output.stdout.trim());
  assert.equal(obj.status,'blocked');
  assert.equal(obj.reason,'explicit_local_approval_required');
});
