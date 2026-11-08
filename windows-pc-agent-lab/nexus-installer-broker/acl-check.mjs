/**
 * Privileged ACL check delegates to the pinned .NET native launcher.
 * No PowerShell, inherited PSModulePath, dynamic scripts or arbitrary paths.
 * Launcher verifies its own Program Files path, high token, ACL owner and
 * all imported modules, runtime binary and staging/journal parent ACLs.
 */
import {spawnSync} from 'node:child_process';
import {BROKER_LAUNCHER,BROKER_ROOT} from './task-xml.mjs';
export const PROTECTED_CODE_ROOT=BROKER_ROOT;
export const PROTECTED_DATA_ROOT='C:\\ProgramData\\NEXUS\\InstallerBroker';
export function verifyProtectedAcls({spawn=spawnSync}={}){
  if(process.platform!=='win32')return false;
  const r=spawn(BROKER_LAUNCHER,['--verify-acl'],
    {windowsHide:true,timeout:18000,encoding:'utf8',maxBuffer:1024});
  return !r.error&&r.status===0;
}
