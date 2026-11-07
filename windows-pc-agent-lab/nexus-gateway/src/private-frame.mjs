/**
 * NEXUS private owner frame transport — never available to model MCP tools.
 * A fresh owner-passphrase challenge issues an in-memory 3-minute ticket to
 * the ChatGPT widget. Ticket is bound to the widget sandbox Origin; an
 * ephemeral Ed25519 signature for EACH frame is created server-side.
 * No cookies, URL tokens, images in logs, caches or user storage.
 */
export const PRIVATE_FRAME_TTL_MS=3*60_000;
const encoder=new TextEncoder();
const originAllowed=o=>/^https:\/\/[a-z0-9-]+\.web-sandbox\.oaiusercontent\.com$/.test(o||'');
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const un64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function key(env){
  const token=typeof env.NEXUS_TOKEN==='string'?env.NEXUS_TOKEN.trim():'';
  if(token.length<32)throw Error('private_frame_not_configured');
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode('nexus-private-frame-ticket-v1|'+(env.LIVE_SESSION_EPOCH||'1')+'|'+token));
  return crypto.subtle.importKey('raw',digest,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function makePrivateTicket(env,origin,now=Date.now()){
  if(!originAllowed(origin))throw Error('private_view_bad_origin');
  const random=new Uint8Array(16);crypto.getRandomValues(random);
  const payload=b64u(encoder.encode(JSON.stringify({v:1,o:origin,e:now+PRIVATE_FRAME_TTL_MS,n:b64u(random)})));
  const sig=b64u(await crypto.subtle.sign('HMAC',await key(env),encoder.encode(payload)));
  return payload+'.'+sig;
}
export async function verifyPrivateTicket(env,ticket,origin,now=Date.now()){
  if(!originAllowed(origin)||typeof ticket!=='string'||ticket.length>1024||
     !/^[A-Za-z0-9_-]{40,850}\.[A-Za-z0-9_-]{43}$/.test(ticket))return false;
  const [payload,mac]=ticket.split('.');
  // Reject alternative noncanonical Base64URL strings for identical signature bytes.
  // A changed trailing sextet must never be accepted as an unchanged ticket.
  try{if(b64u(un64(mac))!==mac||b64u(un64(payload))!==payload)return false;}
  catch{return false;}
  let valid=false;
  try{valid=await crypto.subtle.verify('HMAC',await key(env),un64(mac),encoder.encode(payload));}catch{return false;}
  if(!valid)return false;
  try{
    const v=JSON.parse(new TextDecoder().decode(un64(payload)));
    return v?.v===1&&v.o===origin&&typeof v.n==='string'&&v.n.length>=20&&
      Number.isSafeInteger(v.e)&&v.e>now&&v.e<=now+PRIVATE_FRAME_TTL_MS;
  }catch{return false;}
}
const responseHeaders=origin=>({
  'access-control-allow-origin':origin,
  'access-control-allow-methods':'POST, OPTIONS',
  'access-control-allow-headers':'authorization, content-type, x-nexus-widget',
  'access-control-expose-headers':'x-nexus-frame',
  'cache-control':'no-store',
  'pragma':'no-cache',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'vary':'Origin'
});
export async function handlePrivateFrame(request,env,{callHost,signOwnerFrame}){
  const origin=request.headers.get('origin')||'';
  if(!originAllowed(origin))return new Response(null,{status:403});
  const headers=responseHeaders(origin);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST'||request.headers.get('x-nexus-widget')!=='1')
    return new Response(null,{status:403,headers});
  const match=/^Bearer ([A-Za-z0-9_.-]{40,1024})$/.exec(request.headers.get('authorization')||'');
  if(!match||!(await verifyPrivateTicket(env,match[1],origin)))
    return new Response(null,{status:401,headers});
  let p;try{const raw=await request.text();if(raw.length>100)p=null;else p=JSON.parse(raw);}catch{p=null;}
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='maxWidth'||
     ![960,1600].includes(p.maxWidth))return new Response(null,{status:400,headers});
  const ts=Date.now(),quality=60;
  const nonce=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
  const sig=await signOwnerFrame(env,{maxWidth:p.maxWidth,quality,nonce,ts});
  const r=await callHost('owner_frame',{maxWidth:p.maxWidth,quality,nonce,ts,sig});
  if(!r.ok)return new Response(null,{status:503,headers});
  if(r.result?.isError)return new Response(null,{status:409,headers});
  const sc=r.result?.structuredContent;
  if(sc?.state==='ready')return new Response(null,{status:204,headers});
  if(sc?.state==='off')return new Response(null,{status:409,headers});
  const im=(r.result?.content||[]).find(c=>c.type==='image'&&c.mimeType==='image/jpeg');
  if(sc?.state!=='live'||!im||typeof im.data!=='string')return new Response(null,{status:502,headers});
  let bytes;try{bytes=un64(im.data.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''));}catch{return new Response(null,{status:502,headers});}
  if(bytes.length<3||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff)
    return new Response(null,{status:502,headers});
  const meta=[sc.imageW,sc.imageH,sc.screenW,sc.screenH,sc.cursor?.x??-1,sc.cursor?.y??-1];
  if(meta.some(x=>!Number.isSafeInteger(x)||x>100000||x< -1))return new Response(null,{status:502,headers});
  return new Response(bytes,{status:200,headers:{...headers,'content-type':'image/jpeg','x-nexus-frame':meta.join(',')}});
}
