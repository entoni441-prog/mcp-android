// Safe external HTTP smoke test. Never enrolls or modifies a device.
import assert from 'node:assert/strict';
const ORIGIN='https://pc-agent-readonly-lab.entoni441.workers.dev';
async function check(method,path,body,status,expected){
  const r=await fetch(ORIGIN+path,{
    method,redirect:'error',signal:AbortSignal.timeout(15000),
    headers:body?{'content-type':'application/json'}:undefined,
    body:body?JSON.stringify(body):undefined
  });
  const x=await r.json();
  assert.equal(r.status,status,method+' '+path+': '+JSON.stringify(x));
  for(const [key,value] of Object.entries(expected)) assert.equal(x[key],value,method+' '+path+' '+key);
  console.log(`${method} ${path}: ${r.status} PASS`);
}
await check('GET','/health',undefined,200,{status:'ready',component:'pc-agent-readonly-lab',execution:'forbidden'});
await check('GET','/v1/reports',undefined,404,{error:'not_found'});
await check('POST','/v1/approve',{id:'dummy'},404,{error:'not_found'});
await check('GET','/v1/status?id=bad',undefined,400,{error:'invalid_device'});
await check('POST','/v1/report',{id:'dummy'},400,{error:'invalid_report'});
await check('POST','/v2/exec',{command:'whoami'},404,{error:'not_found'});
await check('POST','/v2/reports',{id:'dummy'},404,{error:'not_found'});
await check('POST','/v2/enroll',{id:'dummy'},400,{error:'invalid_enrollment'});
await check('POST','/v2/status',{id:'00000000000000000000000000000000'},404,{error:'unrecognized'});
console.log('All public live smoke tests passed. No device state changed.');
