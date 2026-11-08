#!/usr/bin/env node
/**
 * Restricted on-demand privileged worker. Until the owner provisions the
 * protected runner, trust roots, ACLs and OS task via REAL Windows UAC, this
 * file is INERT. It may not run from the user-writable GitHub checkout.
 *
 * Neither chat text nor Live button data can mint their own signed approvals.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInstallerBroker} from './broker.mjs';
import {createProtectedJournal} from './journal.mjs';
import {createWindowsInstallerIo,windowsIsElevated} from './windows-io.mjs';
import {verifyProtectedAcls,PROTECTED_CODE_ROOT,PROTECTED_DATA_ROOT} from './acl-check.mjs';
import {BROKER_RUNNER} from './task-xml.mjs';

const file=path.win32.join(PROTECTED_DATA_ROOT,'inbox','current.json');
function strictTrust(pathname){
  const d=fs.lstatSync(pathname);
  if(!d.isFile()||d.isSymbolicLink()||d.size>16_384)throw Error('invalid_protected_trust');
  const cfg=JSON.parse(fs.readFileSync(pathname,'utf8'));
  if(cfg?.version!==1||!cfg?.keys||typeof cfg.keys!=='object')throw Error('trust_not_provisioned');
  const keys={chat:{},live:{}};
  for(const channel of ['chat','live']){
    const entries=cfg.keys[channel];
    if(!entries||typeof entries!=='object'||Object.keys(entries).length!==1)
      throw Error('trusted_channel_missing');
    for(const [id,pem] of Object.entries(entries)){
      if(!/^[a-z0-9-]{1,64}$/.test(id)||typeof pem!=='string'||pem.length>2048)
        throw Error('invalid_channel_key');
      const k=crypto.createPublicKey(pem);
      if(k.asymmetricKeyType!=='ed25519')throw Error('invalid_signer_algorithm');
      keys[channel][id]=k;
    }
  }
  return keys;
}
export function fixedRunnerIsProvisioned({selfPath=fileURLToPath(import.meta.url),
    expected=BROKER_RUNNER,elevated=windowsIsElevated(),
    aclValid=verifyProtectedAcls()}={}){
  // This must reject all attempts to run the dev clone at Medium Integrity.
  return process.platform==='win32' &&
    path.win32.normalize(selfPath).toLowerCase()===path.win32.normalize(expected).toLowerCase() &&
    elevated===true && aclValid===true;
}
/** Mirrors the existing NEXUS owner STOP marker (a deny-only signal).
 * Unreadable/corrupt marker fails closed. Owner STOP never grants privilege.
 */
export function isOwnerStopped({home=os.homedir(),fsImpl=fs}={}){
  try{
    if(fsImpl.existsSync(path.win32.join(PROTECTED_DATA_ROOT,'STOP')))return true;
    const ownerFile=path.win32.join(home,'.nexus-host','owner-stop.json');
    if(!fsImpl.existsSync(ownerFile))return false;
    const stop=JSON.parse(fsImpl.readFileSync(ownerFile,'utf8'));
    return stop?.stopped!==false;
  }catch{return true;}
}

export async function runOne(){
  if(!fixedRunnerIsProvisioned())throw Error('broker_not_provisioned');
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>16_384)
    throw Error('approval_inbox_invalid');
  // Owner-writable inbox is UNTRUSTED; signature is ALWAYS checked before an
  // operation is claimed and before the MSI process is started.
  const envelope=JSON.parse(fs.readFileSync(file,'utf8'));
  const keys=strictTrust(path.win32.join(PROTECTED_CODE_ROOT,'trust.json'));
  const journal=createProtectedJournal(path.win32.join(PROTECTED_DATA_ROOT,'journal'));
  const io=createWindowsInstallerIo();
  const broker=createInstallerBroker({keys,journal,io,
    privilegedReady:()=>fixedRunnerIsProvisioned(),
    stopRequested:()=>isOwnerStopped(),
    audit:()=>{}});
  return broker.install(envelope);
}
const main=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.win32.normalize(process.argv[1]).toLowerCase()===
  path.win32.normalize(main).toLowerCase()){
  if(process.argv.length!==3||process.argv[2]!=='--run-once'){
    process.stderr.write('NEXUS_INSTALLER_DENY: invalid_invocation\n');process.exitCode=30;
  }else runOne().then(r=>{
    // No secrets or installer output; only approved receipt/status.
    process.stdout.write(JSON.stringify({status:r.status,requestId:r.requestId})+'\n');
  }).catch(()=>{
    process.stderr.write('NEXUS_INSTALLER_DENY: unavailable_or_unverified\n');
    process.exitCode=31;
  });
}
