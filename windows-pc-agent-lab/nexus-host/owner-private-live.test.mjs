import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {OWNER_TOOLS,ownerFrameMessage,verifyOwnerFrame} from './server.mjs';
import {TOOLS} from './catalog.mjs';
import {createLive} from './live.mjs';

test('owner frame uses distinct Ed25519 scope, cannot be requested from model catalog',()=>{
 const keys=crypto.generateKeyPairSync('ed25519');
 const args={maxWidth:960,quality:60,nonce:'a'.repeat(32),ts:Date.now()};
 const sig=crypto.sign(null,Buffer.from(ownerFrameMessage(args)),keys.privateKey).toString('base64url');
 assert.equal(verifyOwnerFrame(keys.publicKey,{...args,sig}),true);
 assert.equal(verifyOwnerFrame(keys.publicKey,{...args,maxWidth:1600,sig}),false);
 assert.equal(verifyOwnerFrame(keys.publicKey,{...args,nonce:'b'.repeat(32),sig}),false);
 assert.equal(verifyOwnerFrame(keys.publicKey,{...args,ts:args.ts+1,sig}),false);
 assert.equal(OWNER_TOOLS.has('owner_frame'),true);
 assert.equal(TOOLS.some(t=>t.name==='owner_frame'),false);
});
test('authenticated owner widget uses direct unmasked view; raw gateway frame cache remains independently redacted',async()=>{
 const calls=[];
 const jpeg=s=>Buffer.from(s,'utf8');
 const meta={imageW:960,imageH:540,screenW:1280,screenH:720,cursorX:4,cursorY:9};
 const live=createLive({
   caps:{live_view:true},store:{set:()=>({})},indicator:()=>{},
   setIntervalFn:()=>null,now:()=>1000000,
   capture:async()=>{calls.push('ordinary');return {jpeg:jpeg('MASKED'),meta};},
   ownerCapture:async()=>{calls.push('owner');return {jpeg:jpeg('PRIVATE'),meta};}
 });
 const a=await live.live_frame({maxWidth:960,quality:60});
 assert.equal(Buffer.from(a.content[0].data,'base64').toString(),'PRIVATE');
 const b=await live.owner_frame({maxWidth:960,quality:60});
 assert.equal(Buffer.from(b.content[0].data,'base64').toString(),'PRIVATE');
 const c=await live.live_frame({maxWidth:960,quality:60});
 assert.equal(Buffer.from(c.content[0].data,'base64').toString(),'PRIVATE');
 const redacted=await live.frameBytes(960,60);
 assert.equal(redacted.jpeg.toString(),'MASKED');
 assert.deepEqual(calls,['owner','owner','owner','ordinary']);
 assert.equal(b.structured.imageW,960);
 assert.equal(live.status().state,'live');
 live.stop();
});
test('owner private frame remains gated by live_view grant',async()=>{
 const caps={live_view:false};
 let ownerCalls=0;
 const live=createLive({caps,store:{set:()=>({})},setIntervalFn:()=>null,
   ownerCapture:async()=>{ownerCalls++;return {jpeg:Buffer.alloc(0),meta:{}};},
   capture:async()=>({jpeg:Buffer.alloc(0),meta:{}})});
 assert.equal((await live.owner_frame({})).state,'off');
 assert.equal(ownerCalls,0);
 live.stop();
});
