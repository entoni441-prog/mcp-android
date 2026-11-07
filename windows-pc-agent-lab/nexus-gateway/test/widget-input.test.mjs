import test from 'node:test';
import assert from 'node:assert/strict';
import {framePointToScreen} from '../src/widget-input.mjs';

const frame={screenW:2560,screenH:1440,imageW:960,imageH:540};
const rect={left:23,top:140,width:320,height:180};

test('owner touch: map rendered frame to primary screen points (HiDPI/downscaled)',()=>{
  assert.deepEqual(framePointToScreen(183,230,rect,frame),{x:1280,y:720});
  assert.deepEqual(framePointToScreen(23,140,rect,frame),{x:0,y:0});
  assert.deepEqual(framePointToScreen(342,319,rect,frame),{x:2552,y:1432});
});
test('owner touch: reject clicks outside image, missing frame, and invalid sizes',()=>{
  for (const point of [[22,230],[343,230],[30,139],[30,320],[NaN,150]]) {
    assert.equal(framePointToScreen(point[0],point[1],rect,frame),null);
  }
  assert.equal(framePointToScreen(183,230,rect,{...frame,screenW:0}),null);
  assert.equal(framePointToScreen(183,230,{...rect,width:0},frame),null);
  assert.equal(framePointToScreen(183,230,rect,{}),null);
});
test('owner touch: mapping is based on actual img rectangle, not outer video box',()=>{
  const image={left:50,top:100,width:200,height:112.5};
  assert.deepEqual(framePointToScreen(150,156.25,image,frame),{x:1280,y:720});
  assert.equal(framePointToScreen(20,156.25,image,frame),null);
});
