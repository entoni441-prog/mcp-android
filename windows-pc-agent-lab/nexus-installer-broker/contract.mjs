/**
 * NEXUS Installer Broker (experimental; NOT a privileged service).
 *
 * Chat and Live are independent AUTHENTICATED APPROVAL issuers. Merely setting
 * channel:'chat' is never sufficient. An approval is valid only if it bears a
 * signature from that channel's separately provisioned trust root.
 *
 * DO NOT expose signing keys in model tool arguments, Host configuration,
 * unprivileged workspace, query strings or logs.
 */
import crypto from 'node:crypto';

const HEX64=/^[0-9a-f]{64}$/;
const ID=/^[0-9a-f]{32}$/;
const CHANNELS=Object.freeze(['chat','live']);
export const MAX_AGE_MS=5*60*1000;
export const ALLOWED_INSTALLS=Object.freeze({
  'chrome-remote-desktop-host-157':Object.freeze({
    kind:'msi',
    filename:'chromeremotedesktophost.msi',
    displayName:'Chrome Remote Desktop Host',
    publisher:'Google LLC',
    bytes:24616960,
    sha256:'1aef26d305b0091bba71589d3caaabe6db5a042648e5801969332086db7c1a90',
    service:'chromoting',
    requireNoReboot:true
  })
});

function assertExactKeys(value,keys){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    Object.keys(value).length===keys.length && keys.every(k=>Object.hasOwn(value,k));
}
export function approvalMessage(input){
  if(!assertExactKeys(input,['version','requestId','channel','packageId','artifactSha256','issuedAt','expiresAt']))
    throw Error('approval_schema_invalid');
  if(input.version!==1||!ID.test(input.requestId)||!CHANNELS.includes(input.channel)||
     typeof input.packageId!=='string'||!Object.hasOwn(ALLOWED_INSTALLS,input.packageId)||
     !HEX64.test(input.artifactSha256)||!Number.isSafeInteger(input.issuedAt)||
     !Number.isSafeInteger(input.expiresAt)) throw Error('approval_fields_invalid');
  const pkg=ALLOWED_INSTALLS[input.packageId];
  if(input.artifactSha256!==pkg.sha256)throw Error('package_digest_not_allowlisted');
  // Fixed serialization, not JSON of attacker-controlled property order.
  return Buffer.from([
    'NEXUS_INSTALL_APPROVAL_V1',input.version,input.requestId,input.channel,
    input.packageId,input.artifactSha256,input.issuedAt,input.expiresAt
  ].join('|'),'utf8');
}
export function verifyApproval(envelope,{publicKeys,now=Date.now()}={}){
  if(!assertExactKeys(envelope,['payload','signature','keyId']))throw Error('approval_envelope_invalid');
  const message=approvalMessage(envelope.payload);
  const data=envelope.payload;
  if(!Number.isSafeInteger(now)||data.issuedAt>now+30_000 ||
     now>=data.expiresAt||data.expiresAt<=data.issuedAt||
     data.expiresAt-data.issuedAt>MAX_AGE_MS)throw Error('approval_expired_or_invalid_time');
  if(typeof envelope.signature!=='string'||!/^[A-Za-z0-9_-]{70,120}$/.test(envelope.signature))
    throw Error('approval_signature_invalid');
  if(typeof envelope.keyId!=='string'||!/^[a-z0-9-]{1,64}$/.test(envelope.keyId))
    throw Error('approval_key_invalid');
  // Exact channel-and-key-id match prevents the chat signer from minting Live
  // approvals and vice versa. Missing channel root means hard refusal.
  const key=publicKeys?.[data.channel]?.[envelope.keyId];
  if(!key)throw Error('channel_trust_root_missing');
  const signature=Buffer.from(envelope.signature,'base64url');
  if(signature.length!==64||!crypto.verify(null,message,key,signature))
    throw Error('approval_signature_invalid');
  return Object.freeze({id:data.requestId,channel:data.channel,packageId:data.packageId,
    sha256:data.artifactSha256,issuerKeyId:envelope.keyId,expiresAt:data.expiresAt});
}
export function createSignedTestApproval({privateKey,channel='chat',requestId,now=Date.now(),
    packageId='chrome-remote-desktop-host-157',keyId='test-'+channel}){
  // TEST ONLY. No production signing endpoint or private key is created here.
  const payload={version:1,requestId,channel,packageId,
    artifactSha256:ALLOWED_INSTALLS[packageId].sha256,
    issuedAt:now,expiresAt:now+MAX_AGE_MS};
  const signature=crypto.sign(null,approvalMessage(payload),privateKey).toString('base64url');
  return {payload,signature,keyId};
}
