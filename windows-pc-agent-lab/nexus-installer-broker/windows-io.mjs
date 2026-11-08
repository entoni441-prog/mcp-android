/**
 * Windows-only I/O adapter. This is NOT remotely callable by itself.
 * The OS-elevated on-demand task must first be provisioned by the owner,
 * with protected source code, staging and journal ACLs.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ALLOWED_INSTALLS} from './contract.mjs';
import {fixedInstallCommand,SECURE_STAGE} from './broker.mjs';
import {inspectSignedGoogleMsi,trustedSourcePath,trustedStagePath} from './windows-package.mjs';

const pkg=ALLOWED_INSTALLS['chrome-remote-desktop-host-157'];
const isSame=(a,b)=>typeof a==='string'&&typeof b==='string'&&
  path.win32.normalize(a).toLowerCase()===path.win32.normalize(b).toLowerCase();

export function windowsIsElevated({spawn=spawnSync}={}){
  if(process.platform!=='win32')return false;
  const code=`$p=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent());if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 0}else{exit 7}`;
  const r=spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-Command',code],
    {encoding:'utf8',timeout:10000,windowsHide:true,maxBuffer:1024});
  return r.status===0&&!r.error;
}
export function createWindowsInstallerIo({sourceHome=os.homedir(),spawn=spawnSync}={}){
  if(process.platform!=='win32')throw Error('windows_only');
  const source=trustedSourcePath(sourceHome), stage=trustedStagePath();
  return Object.freeze({
    async readVerifiedSource(packageId,p){
      if(packageId!=='chrome-remote-desktop-host-157'||p!==pkg)
        throw Error('package_not_allowlisted');
      return inspectSignedGoogleMsi(source,{home:sourceHome,spawn});
    },
    async copyToProtectedStage(meta,p,root){
      if(p!==pkg||root!==SECURE_STAGE||!isSame(meta?.path,source))
        throw Error('staging_contract_denied');
      const st=fs.lstatSync(root);
      if(!st.isDirectory()||st.isSymbolicLink())throw Error('protected_staging_missing');
      // OS provisioner MUST set Admin-only write ACL here. Any existing
      // stage gets full hash/signer re-verification before proceeding.
      try{fs.copyFileSync(source,stage,fs.constants.COPYFILE_EXCL);}
      catch(e){if(e?.code!=='EEXIST')throw e;}
      const file=fs.lstatSync(stage);
      if(!file.isFile()||file.isSymbolicLink())throw Error('staged_file_untrusted');
      return {path:stage};
    },
    async readVerifiedStage(file,p){
      if(p!==pkg||!isSame(file,stage))throw Error('staged_path_untrusted');
      return inspectSignedGoogleMsi(stage,{home:sourceHome,spawn});
    },
    async runFixedInstaller(cmd){
      const fixed=fixedInstallCommand(stage,pkg.sha256);
      if(cmd?.exe!==fixed.exe||JSON.stringify(cmd?.args)!==JSON.stringify(fixed.args))
        throw Error('arbitrary_command_refused');
      // No shell, no arbitrary switches, no restart, no sensitive stdout.
      const r=spawn(fixed.exe,fixed.args,{windowsHide:true,timeout:5*60*1000,
        encoding:'utf8',maxBuffer:4096});
      if(r.error||r.signal)return {exitCode:null};
      return {exitCode:Number.isInteger(r.status)?r.status:null};
    },
    async verifyInstalled(p){
      if(p!==pkg)throw Error('package_not_allowlisted');
      const r=spawn('C:\\Windows\\System32\\sc.exe',['query','chromoting'],
        {windowsHide:true,timeout:12000,encoding:'utf8',maxBuffer:2048});
      return r.status===0&&!r.error;
    }
  });
}
