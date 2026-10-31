#!/usr/bin/env node
/** Windows PC Agent v2 (opt-in, foreground-only, read-only heartbeat).
 * No npm dependencies, admin elevation, startup tasks, inbound ports, remote commands,
 * shell from network, screenshots, file inventory, or persistence as a service.
 * Private ECDSA key is encrypted at rest with CURRENT-USER Windows DPAPI.
 */
import os from 'node:os';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes,generateKeyPairSync,createHash,createPrivateKey,sign} from 'node:crypto';

const ENDPOINT='https://pc-agent-readonly-lab.entoni441.workers.dev';
const DIR=path.join(process.env.LOCALAPPDATA||'', 'PcAgentReadonlyLab');
const IDENTITY_FILE=path.join(DIR,'identity-v2.json');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freshId=()=>randomBytes(16).toString('hex');

function dpapi(mode,plaintextOrCiphertext){
  // No secret in shell command-line arguments; stdin carries base64, no temp plaintext files.
  const script=`$ErrorActionPreference='Stop';
  $value=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()));
  Add-Type -AssemblyName System.Security -ErrorAction Stop;
  $scope=[System.Security.Cryptography.DataProtectionScope]::CurrentUser;
  if('${mode}' -eq 'protect') {$out=[System.Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($value),$null,$scope)}
  else {$out=[System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($value),$null,$scope)};
  [Console]::Out.Write([Convert]::ToBase64String($out));`;
  const encoded=Buffer.from(script,'utf16le').toString('base64');
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{
    input:Buffer.from(plaintextOrCiphertext,'utf8').toString('base64'),encoding:'utf8',timeout:15000,
    maxBuffer:1024*1024,windowsHide:true
  });
  if(result.status!==0||result.error)throw Error('Windows DPAPI is unavailable (nothing transmitted).');
  const output=result.stdout.trim();
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(output))throw Error('Unable to decode Windows DPAPI result.');
  return mode==='protect'?output:Buffer.from(output,'base64').toString('utf8');
}

function saveIdentity(x){
  mkdirSync(DIR,{recursive:true});
  const temp=path.join(DIR,'.identity-'+freshId()+'.tmp');
  try{writeFileSync(temp,JSON.stringify(x),{flag:'wx',mode:0o600});renameSync(temp,IDENTITY_FILE);}
  finally{if(existsSync(temp))rmSync(temp);}
}
function readIdentity(){
  if(!existsSync(IDENTITY_FILE))throw Error('No v2 identity; enroll first.');
  const x=JSON.parse(readFileSync(IDENTITY_FILE,'utf8'));
  if(x.schema!==2||!/^[0-9a-f]{32}$/.test(x.id)||typeof x.protectedPem!=='string')throw Error('Invalid local identity.');
  return x;
}
function makeSigned(route,identity,privateKey,additional={}){
  const body={id:identity.id,timestamp:Math.floor(Date.now()/1000),nonce:freshId(),...additional};
  const canonical=['pc-agent-v2','POST',route,JSON.stringify(body)].join('\n');
  const signature=sign('sha256',Buffer.from(canonical),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
  return {...body,signature};
}
async function api(route,data){
  const response=await fetch(ENDPOINT+route,{
    method:'POST',headers:{'content-type':'application/json','accept':'application/json'},
    body:JSON.stringify(data),signal:AbortSignal.timeout(10000),redirect:'error'
  });
  const raw=await response.text();
  if(raw.length>1500)throw Error('Unexpected large server response.');
  let payload;
  try{payload=JSON.parse(raw);}catch{throw Error('Invalid server response.');}
  return {http:response.status,...payload};
}
async function enroll(){
  if(existsSync(IDENTITY_FILE))throw Error('Identity already exists. Never overwrite approved keys automatically.');
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const exported=publicKey.export({format:'jwk'});
  const jwk={kty:'EC',crv:'P-256',x:exported.x,y:exported.y};
  const fingerprint=createHash('sha256').update(JSON.stringify(jwk)).digest('hex').slice(0,16);
  const pem=privateKey.export({format:'pem',type:'pkcs8'}).toString();
  // Fail closed if DPAPI is unavailable, BEFORE contacting the server.
  const protectedPem=dpapi('protect',pem);
  const identity={schema:2,id:freshId(),fingerprint,protectedPem};
  console.log('Windows read-only agent v2; fingerprint:',fingerprint);
  const response=await api('/v2/enroll',{id:identity.id,publicKey:jwk});
  if(response.http!==202||response.status!=='pending'||response.fingerprint!==fingerprint)
    throw Error('Enrollment unavailable: '+(response.error||response.http));
  saveIdentity(identity);
  console.log('Registration pending. Share ONLY fingerprint with ChatGPT for approval.');
  console.log('Stop anytime: Ctrl+C. Pending request expires in 15 minutes.');
  for(let i=0;i<72;i++){
    const state=await api('/v2/status',makeSigned('/v2/status',identity,privateKey));
    if(state.status==='approved'){console.log('Approved; identity stored with Windows DPAPI. No telemetry sent yet.');return;}
    if(state.status==='rejected'||state.status==='expired')throw Error('Pairing '+state.status+'.');
    if(state.http!==200)throw Error('Could not verify approval state.');
    await sleep(10000);
  }
  throw Error('Approval timeout; identity retained for manual review, no telemetry sent.');
}
function metrics(){
  const gb=n=>Math.round(n/1073741824*10)/10;
  return {kind:'windows-readonly-v2',nodeVersion:process.version,
    uptimeSec:Math.floor(os.uptime()),ramTotalGb:gb(os.totalmem()),ramFreeGb:gb(os.freemem())};
}
async function run(){
  const identity=readIdentity();
  const privateKey=createPrivateKey(dpapi('unprotect',identity.protectedPem));
  // No background service and no unattended autostart. This foreground run is capped.
  const args=process.argv.slice(3);
  if(args.length>1||args.some(x=>!/^--minutes=(?:[1-9]|[1-5]\d|60)$/.test(x)))
    throw Error('Allowed option: --minutes=1..60');
  const minutes=args[0]?Number(args[0].split('=')[1]):10;
  const state=await api('/v2/status',makeSigned('/v2/status',identity,privateKey));
  if(state.http!==200||state.status!=='approved'||!Number.isSafeInteger(state.lastSeq)||state.lastSeq<0)
    throw Error('Device not approved (or status unavailable).');
  console.log('Read-only foreground metrics; 60s interval, maximum '+minutes+' minutes. Stop: Ctrl+C.');
  let seq=state.lastSeq;
  const stopAt=Date.now()+minutes*60000;
  while(Date.now()<stopAt){
    const report=metrics();
    const reply=await api('/v2/heartbeat',makeSigned('/v2/heartbeat',identity,privateKey,{seq:++seq,metrics:report}));
    if(reply.http!==201||reply.status!=='accepted'||reply.seq!==seq)
      throw Error('Server rejected metrics: '+(reply.error||reply.http));
    console.log('Signed heartbeat acknowledged, seq='+seq);
    if(Date.now()+60000>=stopAt)break;
    await sleep(60000);
  }
  console.log('Finished; no background process remains.');
}
async function main(){
  if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw Error('Windows user session required.');
  if(Number(process.versions.node.split('.')[0])<24)throw Error('Node.js >=24 required.');
  const command=process.argv[2];
  if(command==='enroll'&&process.argv.length===3)return enroll();
  if(command==='run')return run();
  console.log('Usage: node windows-agent-v2.mjs enroll | run [--minutes=1..60]');
}
main().catch(e=>{console.error('STOP:',e.message);process.exitCode=1;});
