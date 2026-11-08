/**
 * Windows ACL fail-closed proof: privileged broker cannot trust files writable
 * by unprivileged identities even if they reside under Program Files.
 * No ACL changes are made here. Provisioner MUST create and secure them.
 */
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const ROOT='C:\\Program Files\\NEXUS\\InstallerBroker';
const DATA='C:\\ProgramData\\NEXUS\\InstallerBroker';
const EXPECTED=[
  ROOT,path.win32.join(ROOT,'run-once.mjs'),path.win32.join(ROOT,'trust.json'),
  path.win32.join(DATA,'staging'),path.win32.join(DATA,'journal')
];
const quote=s=>"'"+s.replaceAll("'","''")+"'";
export function verifyProtectedAcls({spawn=spawnSync,paths=EXPECTED}={}){
  if(process.platform!=='win32')return false;
  if(paths.length!==EXPECTED.length||paths.some((x,i)=>x!==EXPECTED[i]))return false;
  const literals=paths.map(quote).join(',');
  const script=`
$ErrorActionPreference='Stop'
$paths=@(${literals})
$write=[int64][System.Security.AccessControl.FileSystemRights]::Write -bor
       [int64][System.Security.AccessControl.FileSystemRights]::Modify -bor
       [int64][System.Security.AccessControl.FileSystemRights]::FullControl -bor
       [int64][System.Security.AccessControl.FileSystemRights]::Delete -bor
       [int64][System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
       [int64][System.Security.AccessControl.FileSystemRights]::TakeOwnership
foreach($f in $paths){
  if(-not(Test-Path -LiteralPath $f)){exit 21}
  $item=Get-Item -LiteralPath $f -Force
  if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){exit 22}
  $a=Get-Acl -LiteralPath $f
  $owner=($a.Owner -as [Security.Principal.NTAccount])
  $ownerSid=($owner.Translate([Security.Principal.SecurityIdentifier])).Value
  if($ownerSid -notin @('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')){exit 23}
  foreach($entry in $a.Access){
    if($entry.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow){continue}
    $sid=$entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if($sid -notin @('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464') -and
       ((([int64]$entry.FileSystemRights) -band $write) -ne 0)){exit 24}
  }
}
exit 0
`;
  const r=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],
    {timeout:20000,windowsHide:true,encoding:'utf8',maxBuffer:1024});
  return !r.error&&r.status===0;
}
export {ROOT as PROTECTED_CODE_ROOT,DATA as PROTECTED_DATA_ROOT};
