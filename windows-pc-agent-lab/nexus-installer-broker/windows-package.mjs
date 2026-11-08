/**
 * Read-only exact Google MSI verification for Windows. No installation here.
 * Only pre-approved, fixed paths can be inspected; arbitrary command or
 * PowerShell expression input is never accepted.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {ALLOWED_INSTALLS} from './contract.mjs';
import {SECURE_STAGE} from './broker.mjs';

const PACKAGE_ID='chrome-remote-desktop-host-157';
const pkg=ALLOWED_INSTALLS[PACKAGE_ID];
export function trustedSourcePath(home=os.homedir()){
  return path.win32.join(home,'NEXUS-workspace','downloads',pkg.filename);
}
export function trustedStagePath(){
  return path.win32.join(SECURE_STAGE,pkg.sha256+'.msi');
}
function eqPath(a,b){
  return typeof a==='string'&&a.toLowerCase()===b.toLowerCase();
}
function safeQuote(s){return "'"+s.replaceAll("'","''")+"'";}
export function inspectSignedGoogleMsi(file,{home=os.homedir(),spawn=spawnSync}={}){
  if(process.platform!=='win32')throw Error('windows_only');
  if(!eqPath(path.win32.normalize(file),trustedSourcePath(home))&&
     !eqPath(path.win32.normalize(file),trustedStagePath()))
    throw Error('untrusted_msi_path');
  const stat=fs.statSync(file);
  if(!stat.isFile()||stat.size!==pkg.bytes)throw Error('msi_size_mismatch');
  const digest=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if(digest!==pkg.sha256)throw Error('msi_digest_mismatch');
  // A fixed script with a tightly constrained literal path; no shell input
  // from owner messages, model tools, package name or remote web content.
  const command=`$ErrorActionPreference='Stop';$s=Get-AuthenticodeSignature -LiteralPath ${safeQuote(file)};[PSCustomObject]@{State=$s.Status.ToString();Subject=$s.SignerCertificate.Subject}|ConvertTo-Json -Compress`;
  const r=spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-Command',command],
    {encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:4096});
  if(r.error||r.status!==0)throw Error('msi_signer_probe_failed');
  let sig;
  try{sig=JSON.parse(r.stdout);}catch{throw Error('msi_signer_probe_unparseable');}
  if(sig.State!=='Valid'||!/(?:^|,\s*)O=Google LLC(?:,|$)/.test(sig.Subject||''))
    throw Error('msi_signature_not_google');
  return Object.freeze({kind:'msi',sha256:digest,bytes:stat.size,
    signatureValid:true,publisher:pkg.publisher,path:file});
}
