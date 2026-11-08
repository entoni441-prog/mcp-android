#!/usr/bin/env node
/** Owner-approved NEXUS titlebar-v10 Host activation. No secrets printed.
 * Preflight: node <thisfile> --check (safe direct run)
 * Activation: node <thisfile> --deploy ONLY through a standalone Windows Scheduler task.
 * Direct execution from NEXUS Host is rejected by parent-process-chain verification.
 * Changes ONLY three verified Host source files. Never changes system security settings.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const SOURCE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ROOT=path.join(os.homedir(),'Documents','NEXUS');
const HOST=path.join(ROOT,'nexus-host');
const HOME=path.join(os.homedir(),'.nexus-host');
const BACKUP=path.join(ROOT,'_backup-titlebar-v10-pre-20261108');
const STATE=path.join(ROOT,'_activate-titlebar-v10-20261108-state.json');
const LOCK=path.join(ROOT,'_activate-titlebar-v10-20261108.lock');
const TASK='NEXUS-Titlebar-v10-Activation';
const MAINTENANCE=path.join(os.homedir(),'NEXUS-workspace','nexus-recovery-independent','maintenance.json');
const SCRIPT=fileURLToPath(import.meta.url);
const PROBE_REQUEST=path.join(ROOT,'_titlebar_v10_os_owned_probe_request.json');
const PROBE_RESULT=path.join(ROOT,'_titlebar_v10_os_owned_probe_result.json');
const ARM=path.join(ROOT,'_titlebar_v10_os_owned_armed.json');
const OLD={
  'gui.mjs':'3b487cfb1b4b3451e8339d7c7a0e515acd76cd87a91a2ffbc9c467d85bb1f0f5',
  'uia-script.mjs':'02044e8c74c778995a30ddab71245772bff5972ff4bf81a573fc9e6f90571d8e',
  'policy.mjs':'775a16fe70b24dfc7bf51290f10abbbe0f4bcc3c9d38cac26e2df00852fc6a69'
};
const NEW={
  'gui.mjs':'b544780e275a0c4bcb775c115fc28fbc7752217be9b6675b2edb1f4d86cc29c1',
  'uia-script.mjs':'df9e938b37f0a4e8013758b9367fb236fe55ce12e396419963da52894e34acee',
  'policy.mjs':'f1c5051770de025677bc95466589483f99e0cbce8f92035b664ca777433b6240'
};
const FILES=Object.keys(OLD);
const data={phase:'created',at:new Date().toISOString(),backup:BACKUP,source:SOURCE,changed:FILES,events:[]};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const alive=pid=>{if(!Number.isInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
function writeState(phase,detail={}) {
  data.phase=phase;data.events.push({phase,at:new Date().toISOString(),...detail});
  const fd=fs.openSync(STATE+'.tmp','w',0o600);
  try {fs.writeFileSync(fd,JSON.stringify(data,null,2));fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  fs.renameSync(STATE+'.tmp',STATE);
}
function command(exe,args,timeout=16000){
  const r=spawnSync(exe,args,{encoding:'utf8',timeout,windowsHide:true});
  if(r.error)throw Error('child_program_error:'+path.basename(exe));
  return {code:r.status,stdout:String(r.stdout||'').trim()};
}
function verifyHashes(root,expected,tag){
  for(const file of FILES){
    const name=path.join(root,file);
    if(!fs.existsSync(name)||sha(name)!==expected[file])throw Error(tag+':'+file);
  }
}
function processIdentity(pid,kind){
  if(!alive(pid))return false;
  const ps='$p=Get-CimInstance Win32_Process -Filter "ProcessId = '+pid+'";if($null -eq $p){"null"}else{[pscustomobject]@{Pid=$p.ProcessId;Path=$p.ExecutablePath;Line=$p.CommandLine}|ConvertTo-Json -Compress}';
  const r=command('powershell.exe',['-NoProfile','-Command',ps]);
  if(r.code!==0)return false;
  let row;try{row=JSON.parse(r.stdout);}catch{return false;}
  const line=String(row?.Line||'').replace(/\\/g,'/').toLowerCase();
  const executable=String(row?.Path||'').toLowerCase().endsWith('node.exe');
  const folder=line.includes('/documents/nexus/nexus-host/');
  const script=kind==='host'?line.includes('/nexus.mjs'):line.includes('/nexus-supervisor.mjs')&&line.includes('--daemon');
  return executable&&folder&&script;
}
function getPids(){
  if(fs.existsSync(path.join(HOME,'host-off'))||fs.existsSync(path.join(HOME,'owner-stop.json')))throw Error('nexus_stopped_by_owner');
  const host=readJson(path.join(HOME,'host.pid'))?.pid;
  const supervisor=readJson(path.join(HOME,'supervisor.pid'))?.pid;
  if(!processIdentity(host,'host')||!processIdentity(supervisor,'supervisor')||host===supervisor)
    throw Error('host_or_supervisor_identity_unverified');
  const check=command('powershell.exe',['-NoProfile','-Command',"(Get-ScheduledTask -TaskName 'NEXUS-Host-Run').Actions[0].Arguments"]);
  if(check.code!==0||!check.stdout.replace(/\\/g,'/').toLowerCase().includes('/documents/nexus/nexus-host/nexus.mjs'))
    throw Error('startup_task_identity_changed');
  return {host,supervisor};
}
function stopPid(pid,kind){
  if(!alive(pid))return;
  if(!processIdentity(pid,kind))throw Error('unsafe_process_identity:'+kind);
  const exe=path.join(process.env.SystemRoot||'C:/Windows','System32','taskkill.exe');
  const r=command(exe,['/pid',String(pid),'/f']);
  if(r.code!==0&&alive(pid))throw Error('stop_failed:'+kind);
}
async function ensureExit(pid){
  for(let i=0;i<40;i++){if(!alive(pid))return;await sleep(200);}
  throw Error('process_did_not_exit');
}
function startHost(){
  const exe=path.join(process.env.SystemRoot||'C:/Windows','System32','schtasks.exe');
  const r=command(exe,['/run','/tn','NEXUS-Host-Run'],20000);
  if(r.code!==0)throw Error('scheduler_start_failed');
}
function copyFiles(from,expected,tag){
  for(const f of FILES){
    const temp=path.join(HOST,f+'.nxnatural.tmp');
    try{
      fs.copyFileSync(path.join(from,f),temp);
      if(sha(temp)!==expected[f])throw Error('temp_hash_failed:'+f);
      fs.renameSync(temp,path.join(HOST,f));
    }finally{try{if(fs.existsSync(temp))fs.unlinkSync(temp);}catch{}}
  }
  verifyHashes(HOST,expected,tag);
}
async function healthAndTools(){
  try{
    const h=await fetch('http://127.0.0.1:8765/healthz',{signal:AbortSignal.timeout(2600)});
    if(!h.ok)return false;
    const token=fs.readFileSync(path.join(HOME,'token.txt'),'utf8').trim();
    const r=await fetch('http://127.0.0.1:8765/mcp',{
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:12,method:'tools/list',params:{}}),
      signal:AbortSignal.timeout(2600)});
    if(!r.ok)return false;
    const j=await r.json();
    return j.result?.tools?.some(x=>x.name==='owner_ui_pref')===true;
  }catch{return false;}
}
async function recovered(old,withTools){
  for(let i=0;i<50;i++){
    const h=readJson(path.join(HOME,'host.pid'))?.pid;
    const s=readJson(path.join(HOME,'supervisor.pid'))?.pid;
    if(h&&s&&h!==old.host&&s!==old.supervisor&&processIdentity(h,'host')&&processIdentity(s,'supervisor')){
      let health=false;
      try{
        const response=await fetch('http://127.0.0.1:8765/healthz',{signal:AbortSignal.timeout(2500)});
        health=response.ok;
      }catch{}
      const complete=health&&(!withTools||await healthAndTools());
      if(complete)return {hostPid:h,supervisorPid:s,health:true,toolsVerified:withTools};
    }
    await sleep(2000);
  }
  throw Error('recovery_unverified');
}
async function rollback(reason,old){
  writeState('rollback_started',{reason});
  try{
    for(const [k,kind] of [['supervisor','supervisor'],['host','host']]){
      const pid=readJson(path.join(HOME,kind+'.pid'))?.pid;
      if(pid&&alive(pid))stopPid(pid,kind);
    }
    for(const [kind,pid] of [['supervisor',old.supervisor],['host',old.host]])
      if(alive(pid))stopPid(pid,kind);
    await sleep(600);
    copyFiles(BACKUP,OLD,'rollback_hash_failed');
    writeState('rollback_files_restored');
    startHost();
    const r=await recovered(old,false);
    writeState('rollback_verified',r);
  }catch(e){writeState('rollback_failed',{error:String(e?.message||e)});}
}
/** Proof that this worker is not attached to NEXUS Host/Supervisor's Windows process tree. */
function assertIndependent(old){
  const task=command(path.join(process.env.SystemRoot||'C:/Windows','System32','schtasks.exe'),
     ['/Query','/TN',TASK,'/XML'],15000);
  if(task.code!==0 || !task.stdout.toLowerCase().includes(SCRIPT.toLowerCase()))
    throw Error('os_owned_scheduled_task_identity_unverified');
  const ps='$rows=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId;'+
    '$map=@{};foreach($r in $rows){$map[[int]$r.ProcessId]=[int]$r.ParentProcessId};'+
    '$p=[int]'+process.pid+';$ids=@();for($i=0;$i -lt 14;$i++){'+
    'if(-not $map.ContainsKey($p)){break};$p=$map[$p];if($p -lt 1){break};$ids+=@($p)};'+
    'ConvertTo-Json -Compress -InputObject @($ids)';
  const ancestry=command('powershell.exe',['-NoProfile','-Command',ps],20000);
  if(ancestry.code!==0)throw Error('process_parent_validation_failed');
  let ids;try{ids=JSON.parse(ancestry.stdout);}catch{throw Error('process_parent_invalid_json');}
  if(!Array.isArray(ids)||ids.length===0)throw Error('process_parent_unverified');
  if(ids.includes(old.host)||ids.includes(old.supervisor))
    throw Error('in_host_process_tree_refused');
}
function acquireMaintenance(){
  fs.mkdirSync(path.dirname(MAINTENANCE),{recursive:true});
  const now=Date.now();
  const body={version:1,kind:'nexus_os_owned_update_v4',beganAt:now,expiresAt:now+9*60_000};
  const fd=fs.openSync(MAINTENANCE,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(body)+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
}
function releaseMaintenance(){
  try{const v=readJson(MAINTENANCE);
    if(v?.kind==='nexus_os_owned_update_v4'&&v.version===1)fs.unlinkSync(MAINTENANCE);
  }catch{}
}

async function main(){
  if(!['--check','--deploy'].includes(process.argv[2]))throw Error('must_supply_check_or_deploy');
  verifyHashes(HOST,OLD,'installed_version_conflict');
  verifyHashes(SOURCE,NEW,'titlebar_v10_source_hash_mismatch');
  const old=getPids();
  if(process.argv[2]==='--check'){
    console.log(JSON.stringify({status:'PREFLIGHT_PASS',files:FILES,hostPid:old.host,supervisorPid:old.supervisor,backup:BACKUP}));
    return;
  }
  if(fs.existsSync(PROBE_REQUEST)){
    if(fs.existsSync(PROBE_RESULT)||fs.existsSync(ARM))throw Error('probe_conflict');
    const req=readJson(PROBE_REQUEST);
    if(req?.version!==1||req.mode!=='probe'||Object.keys(req).sort().join(',')!=='mode,version')
      throw Error('probe_request_invalid');
    assertIndependent(old);
    fs.writeFileSync(PROBE_RESULT,JSON.stringify({version:1,state:'INDEPENDENT_PASS',at:Date.now(),pid:process.pid}),{flag:'wx',mode:0o600});
    console.log('INDEPENDENT_SCHEDULER_PROBE_PASS');
    return;
  }
  const armed=readJson(ARM);
  const result=readJson(PROBE_RESULT);
  if(armed?.version!==1||armed.mode!=='deploy'||armed.probePid!==result?.pid||
     result?.state!=='INDEPENDENT_PASS'||!Number.isSafeInteger(result?.at)||
     Date.now()-result.at>15*60_000||Date.now()<result.at)
    throw Error('deployment_not_armed_by_verified_probe');
  if(fs.existsSync(LOCK)||fs.existsSync(BACKUP)||fs.existsSync(MAINTENANCE))
    throw Error('existing_update_or_maintenance_marker');
  assertIndependent(old);
  const lock=fs.openSync(LOCK,'wx');fs.writeSync(lock,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));fs.closeSync(lock);
  fs.mkdirSync(BACKUP,{recursive:false});
  for(const f of FILES)fs.copyFileSync(path.join(HOST,f),path.join(BACKUP,f));
  verifyHashes(BACKUP,OLD,'backup_hash_mismatch');
  data.old=old;writeState('backup_verified');
  acquireMaintenance();writeState('maintenance_armed');
  console.log('BACKUP_VERIFIED_OS_OWNED');
  let affected=false;
  try{
    verifyHashes(HOST,OLD,'changed_before_install');
    verifyHashes(SOURCE,NEW,'changed_source_before_install');
    const now=getPids();
    if(now.host!==old.host||now.supervisor!==old.supervisor)throw Error('pid_changed_before_switch');
    affected=true;writeState('stopping_supervisor');
    stopPid(old.supervisor,'supervisor');await ensureExit(old.supervisor);
    writeState('stopping_host');
    stopPid(old.host,'host');await ensureExit(old.host);
    writeState('installing');
    copyFiles(SOURCE,NEW,'installed_hash_mismatch');writeState('files_installed_verified');
    startHost();writeState('scheduler_started');
    const recoveredState=await recovered(old,true);
    writeState('installed_verified',recoveredState);
    releaseMaintenance();
    console.log('HOST_TITLEBAR_V10_INSTALLED_VERIFIED');
  }catch(e){
    const reason=String(e?.message||e);
    if(affected){
      await rollback(reason,old);
      if(data.phase==='rollback_verified')releaseMaintenance();
    }else{
      releaseMaintenance();
      writeState('abort_no_production_changes',{reason});
    }
    process.exitCode=1;
  }
}
main().catch(e=>{try{writeState('preflight_failed',{error:String(e?.message||e)});}catch{};console.error('HOST_INSTALL_PREFLIGHT_FAILED:',String(e?.message||e));process.exitCode=1;});
