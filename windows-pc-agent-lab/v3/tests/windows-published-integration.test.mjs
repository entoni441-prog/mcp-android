/** Windows CI for already-published v3 modules ONLY.
 * Synthetic throwaway v2 DPAPI identity; no Cloudflare access or real user keys.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {generateKeyPairSync,verify} from 'node:crypto';
import {loadIdentityV2,signedV3} from '../identity-v3.mjs';
import {executeJob,validateJob} from '../actions.mjs';

const windows={skip:process.platform!=='win32'};
const scratch=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pcagent-v3-windows-ci-'));

function protectSyntheticPem(pem){
  const script=`$ErrorActionPreference='Stop';
  Add-Type -AssemblyName System.Security -ErrorAction Stop;
  $text=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()));
  $data=[System.Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($text),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);
  [Console]::Out.Write([Convert]::ToBase64String($data));`;
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
    input:Buffer.from(pem,'utf8').toString('base64'),encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:1024*1024
  });
  assert.equal(r.error,undefined,'Synthetic DPAPI protector spawn must work');
  assert.equal(r.status,0,'Synthetic DPAPI protector must return zero');
  const ciphertext=r.stdout.trim();
  assert.match(ciphertext,/^[A-Za-z0-9+/]+={0,2}$/);
  return ciphertext;
}

test('v3 reads v2 DPAPI CurrentUser identity and signs v3 request',windows,()=>{
  const tmp=scratch();
  try{
    const localAppData=path.join(tmp,'LocalAppData');
    const dir=path.join(localAppData,'PcAgentReadonlyLab');
    fs.mkdirSync(dir,{recursive:true});
    const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    const pem=privateKey.export({format:'pem',type:'pkcs8'}).toString();
    const id='1'.repeat(32);
    fs.writeFileSync(path.join(dir,'identity-v2.json'),JSON.stringify({
      schema:2,id,fingerprint:'synthetic-ci-only',protectedPem:protectSyntheticPem(pem)
    }),{flag:'wx'});
    const identity=loadIdentityV2(localAppData);
    assert.equal(identity.id,id);
    const request=signedV3('/v3/poll',identity);
    const {signature,...body}=request;
    const canonical=['pc-agent-v3','POST','/v3/poll',JSON.stringify(body)].join('\n');
    assert.equal(verify('sha256',Buffer.from(canonical),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),true);
    assert.equal(verify('sha256',Buffer.from(canonical+'-tampered'),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),false);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('Windows file workspace supports create, read, optimistic update, and directory list',windows,async()=>{
  const tmp=scratch();
  const workspace=path.join(tmp,'workspace');
  try{
    assert.deepEqual(await executeJob('make_dir',{path:'notes'},{workspace}),{path:'notes',created:true});
    const created=await executeJob('write_text',{path:'notes/test.txt',content:'first',expectedSha256:null},{workspace});
    assert.equal(created.created,true);
    const read=await executeJob('read_text',{path:'notes/test.txt'},{workspace});
    assert.equal(read.text,'first');
    assert.equal(read.sha256,created.sha256);
    const updated=await executeJob('write_text',{path:'notes/test.txt',content:'second',expectedSha256:read.sha256},{workspace});
    assert.equal(updated.created,false);
    assert.equal((await executeJob('read_text',{path:'notes/test.txt'},{workspace})).text,'second');
    await assert.rejects(
      executeJob('write_text',{path:'notes/test.txt',content:'third',expectedSha256:read.sha256},{workspace}),
      /conflict/
    );
    const entries=await executeJob('list_dir',{path:'notes'},{workspace});
    assert.ok(entries.entries.some(x=>x.name==='test.txt'&&x.type==='file'));
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('Windows device names and parent traversal rejected',windows,()=>{
  for(const filename of ['CON','NUL.txt','COM1.log','LPT9','docs/PRN','../escape','nested/../escape','C:/Windows/win.ini','a\\b']){
    assert.throws(()=>validateJob('read_text',{path:filename}),filename);
  }
});

test('v3 signature rejects reserved fields before signing (all OS)',()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const identity={id:'b'.repeat(32),privateKey};
  for(const extra of [
    {id:'c'.repeat(32)}, {timestamp:0}, {nonce:'fixed'}, {signature:'fake'},
    JSON.parse('{"__proto__":"bad"}'),
    {constructor:'x'}, {prototype:'x'}, null, [],
  ])assert.throws(()=>signedV3('/v3/poll',identity,extra),/invalid_signed_fields/);
  const request=signedV3('/v3/poll',identity,{seq:7});
  assert.equal(request.id,identity.id);
  assert.equal(request.seq,7);
  assert.match(request.nonce,/^[0-9a-f]{32}$/);
  const {signature,...body}=request;
  const canonical=['pc-agent-v3','POST','/v3/poll',JSON.stringify(body)].join('\n');
  assert.equal(verify('sha256',Buffer.from(canonical),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),true);
});

test('Windows app actions resolve to absolute local SystemRoot, not PATH (synthetic launcher)',async()=>{
  const tmp=scratch();
  try {
    const launches=[];
    const launcher=(file,args,options)=>{
      launches.push({file,args,options});
      const child=new EventEmitter();
      child.unref=()=>{};
      queueMicrotask(()=>child.emit('spawn'));
      return child;
    };
    const opts={workspace:path.join(tmp,'workspace'),platform:'win32',systemRoot:'C:\\Windows',launcher};
    assert.deepEqual(await executeJob('open_app',{app:'notepad'},opts),{started:true,app:'notepad'});
    assert.equal(launches[0].file,'C:\\Windows\\System32\\notepad.exe');
    assert.equal(launches[0].args.length,0);
    assert.equal(path.win32.isAbsolute(launches[0].file),true);
    assert.deepEqual(await executeJob('open_app',{app:'calculator'},opts),{started:true,app:'calculator'});
    assert.equal(launches[1].file,'C:\\Windows\\System32\\calc.exe');
    for(const systemRoot of ['', 'Windows', '\\\\server\\share']) {
      await assert.rejects(executeJob('open_app',{app:'notepad'},{...opts,systemRoot}),/invalid_windows_system_root/);
    }
    assert.equal(launches.length,2,'Reject unsafe roots before attempting any spawn');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('workspace rejects symlink path escape when supported',async(t)=>{
  const tmp=scratch();
  try{
    const workspace=path.join(tmp,'workspace');
    const outside=path.join(tmp,'outside');
    fs.mkdirSync(workspace);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside,'private.txt'),'never expose this');
    try{fs.symlinkSync(outside,path.join(workspace,'jump'),process.platform==='win32'?'junction':'dir');}
    catch(e){if(['EPERM','EACCES','ENOSYS'].includes(e.code)){t.skip('Symlink creation unavailable on CI runner');return;}throw e;}
    await assert.rejects(
      executeJob('read_text',{path:'jump/private.txt'},{workspace}),
      /symlink_forbidden|path_escape/
    );
    await assert.rejects(
      executeJob('write_text',{path:'jump/new.txt',content:'no',expectedSha256:null},{workspace}),
      /symlink_forbidden|path_escape/
    );
    assert.equal(fs.existsSync(path.join(outside,'new.txt')),false);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
