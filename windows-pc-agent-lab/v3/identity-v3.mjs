/** Reuse the existing, user-approved v2 device key. Never enroll automatically. */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createPrivateKey,sign,randomBytes} from 'node:crypto';
const newNonce=()=>randomBytes(16).toString('hex');
function decryptCurrentUser(ciphertext){
  const script=`$ErrorActionPreference='Stop';
  Add-Type -AssemblyName System.Security -ErrorAction Stop;
  $text=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()));
  $data=[Convert]::FromBase64String($text);
  $out=[System.Security.Cryptography.ProtectedData]::Unprotect($data,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);
  [Console]::Out.Write([Convert]::ToBase64String($out));`;
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
    encoding:'utf8',input:Buffer.from(ciphertext,'utf8').toString('base64'),timeout:15000,maxBuffer:1048576,windowsHide:true
  });
  if(r.error||r.status!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(r.stdout.trim()))throw Error('dpapi_decrypt_failed');
  return Buffer.from(r.stdout.trim(),'base64').toString('utf8');
}
export function loadIdentityV2(localAppData){
  if(!localAppData||process.platform!=='win32')throw Error('windows_only');
  const file=path.join(localAppData,'PcAgentReadonlyLab','identity-v2.json');
  const identity=JSON.parse(readFileSync(file,'utf8'));
  if(identity.schema!==2||typeof identity.id!=='string'||!/^[a-f0-9]{32}$/.test(identity.id)||typeof identity.protectedPem!=='string')throw Error('invalid_identity');
  const key=createPrivateKey(decryptCurrentUser(identity.protectedPem));
  return {id:identity.id,privateKey:key};
}
export function signedV3(route,identity,extra={}){
  // Never permit caller-supplied fields to replace authenticated device identity,
  // freshness, nonce or the signature field itself.
  const reserved=new Set(['id','timestamp','nonce','signature','__proto__','constructor','prototype']);
  if(!extra||typeof extra!=='object'||Array.isArray(extra)||
     Object.keys(extra).some(key=>reserved.has(key)))throw Error('invalid_signed_fields');
  const payload={id:identity.id,timestamp:Math.floor(Date.now()/1000),nonce:newNonce(),...extra};
  const canonical=['pc-agent-v3','POST',route,JSON.stringify(payload)].join('\n');
  const signature=sign('sha256',Buffer.from(canonical),{key:identity.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
  return {...payload,signature};
}
