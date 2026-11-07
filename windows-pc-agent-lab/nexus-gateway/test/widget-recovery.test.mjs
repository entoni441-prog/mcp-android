import test from 'node:test';
import assert from 'node:assert/strict';
import {callOnceAfterStale,isPreExecutionStale} from '../src/widget-input.mjs';

test('stale_args: reobserve after refusal, then EXACTLY one action is performed',async()=>{
  let sends=0,observes=0,actions=0;
  const r=await callOnceAfterStale(async()=>{
    sends++;
    if(sends===1)throw Error('error: stale_args: task_resumed');
    actions++;
    return {done:true};
  },async()=>{observes++;});
  assert.deepEqual(r,{done:true});
  assert.deepEqual([sends,observes,actions],[2,1,1]);
});
test('unknown or ambiguous outcome is NEVER retried',async()=>{
  for(const cause of ['pc_timeout','screen_changed_retry','owner_active','network timeout','stale_args: arbitrary','stopped_by_owner']){
    let sends=0,observes=0;
    await assert.rejects(()=>callOnceAfterStale(async()=>{sends++;throw Error(cause);},async()=>{observes++;}));
    assert.deepEqual([sends,observes],[1,0],cause);
    assert.equal(isPreExecutionStale(cause),false);
  }
});
test('if reobservation fails, no desktop action is retried',async()=>{
  let sends=0,observes=0;
  await assert.rejects(()=>callOnceAfterStale(async()=>{sends++;throw Error('error: stale_args: owner_stop_resumed');},async()=>{
    observes++;throw Error('screen geometry changed');
  }),/screen geometry changed/);
  assert.deepEqual([sends,observes],[1,1]);
});
test('if the one safe retry fails, stop without further attempts',async()=>{
  let sends=0;
  await assert.rejects(()=>callOnceAfterStale(async()=>{
    sends++;throw Error('error: stale_args: task_resumed');
  },async()=>{}),/stale_args/);
  assert.equal(sends,2);
});
test('successful first call never observes or retries',async()=>{
  let sends=0,observes=0;
  const r=await callOnceAfterStale(async()=>{sends++;return {done:true};},async()=>{observes++;});
  assert.deepEqual(r,{done:true});
  assert.deepEqual([sends,observes],[1,0]);
});
