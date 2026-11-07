#!/usr/bin/env node
/** NEXUS universal minimization — installer controller. NO production file mutation.
 * --check: real Host hashes / process read-only preflight
 * --prepare: register ONE new OS-owned, least-privilege Scheduler task for activation
 * --probe: execute that task in nonmutating probe mode and verify it is independent
 * --arm: after PROBE_PASS, make a one-use deploy request (without touching Host)
 * --start: launch OS-owned activator, return before Host stops
 * --status: inspect the durable activation journal
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const TASK='NEXUS-Owner-Private-Live-Activation';
const ROOT=path.join(os.homedir(),'Documents','NEXUS');
const SCRIPT=path.join(path.dirname(fileURLToPath(import.meta.url)),'os-owned-activate-owner-private-live.mjs');
const XML=path.join(ROOT,'_owner_private_live_os_owned_activation.xml');
const PROBE_REQUEST=path.join(ROOT,'_owner_private_live_os_owned_probe_request.json');
const PROBE_RESULT=path.join(ROOT,'_owner_private_live_os_owned_probe_result.json');
const ARM=path.join(ROOT,'_owner_private_live_os_owned_armed.json');
const STATE=path.join(ROOT,'_activate-owner-private-live-20261107-state.json');
const TASK_EXE=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','schtasks.exe');
const WHOAMI=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','whoami.exe');
const quote=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function scheduledXml({sid,node,script}){
  if(!/^S-1-5-21-(?:\d+-){3}\d+$/.test(sid))throw Error('invalid_owner_sid');
  if(!path.win32.isAbsolute(node)||!/(?:^|[\\/])node\.exe$/i.test(node))throw Error('invalid_node');
  if(!path.win32.isAbsolute(script)||!/[\\/]os-owned-activate-owner-private-live\.mjs$/i.test(script))throw Error('invalid_script');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
 <RegistrationInfo><Description>NEXUS universal minimization guarded OS-owned one-time activation. Never direct from NEXUS Host.</Description></RegistrationInfo>
 <Triggers><TimeTrigger><StartBoundary>2035-01-01T00:00:00</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>
 <Principals><Principal id="Owner"><UserId>${quote(sid)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
 <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><StartWhenAvailable>false</StartWhenAvailable><ExecutionTimeLimit>PT7M</ExecutionTimeLimit><Enabled>true</Enabled></Settings>
 <Actions Context="Owner"><Exec><Command>${quote(node)}</Command><Arguments>&quot;${quote(script)}&quot; --deploy</Arguments><WorkingDirectory>${quote(path.win32.dirname(script))}</WorkingDirectory></Exec></Actions>
</Task>`;
}
const readJson=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
function execute(exe,args,timeout=35000){
  const r=spawnSync(exe,args,{encoding:'utf8',timeout,windowsHide:true,maxBuffer:150000});
  return {code:r.status,output:String(r.stdout||'').trim(),err:String(r.stderr||'').trim()};
}
function mustExist(file){
  if(!fs.existsSync(file))throw Error('missing_file:'+path.basename(file));
}
function verifyTask(){
  const r=execute(TASK_EXE,['/Query','/TN',TASK,'/XML'],13000);
  if(r.code!==0)throw Error('scheduled_task_missing');
  const xml=r.output;
  const script=SCRIPT.toLowerCase();
  if(!xml.toLowerCase().includes(script)||!xml.includes('--deploy')||
     !/InteractiveToken/.test(xml)||!/IgnoreNew/.test(xml))throw Error('scheduler_action_changed');
  return true;
}
function preflight(){
  const r=execute(process.execPath,[SCRIPT,'--check'],22000);
  if(r.code!==0||!r.output.includes('PREFLIGHT_PASS'))throw Error('host_source_or_pid_preflight_failed:'+r.err.slice(0,180));
  return r.output;
}
function principalSid(){
  const r=execute(WHOAMI,['/user','/fo','csv','/nh'],10000);
  const s=r.output.match(/S-1-5-21-(?:\d+-){3}\d+/)?.[0];
  if(r.code!==0||!s)throw Error('owner_sid_unavailable');
  return s;
}
async function main(){
  const action=process.argv[2];
  if(process.platform!=='win32'||process.argv.length!==3||
     !['--check','--prepare','--probe','--arm','--start','--status'].includes(action))throw Error('invalid_invocation');
  if(action==='--status'){
    console.log(JSON.stringify({task:verifyTask(),probe:readJson(PROBE_RESULT),armed:readJson(ARM),journal:readJson(STATE)}));
    return;
  }
  if(action==='--check'){console.log(preflight());return;}
  if(action==='--prepare'){
    const details=preflight();
    if(fs.existsSync(PROBE_REQUEST)||fs.existsSync(PROBE_RESULT)||fs.existsSync(ARM)||fs.existsSync(STATE)||
       fs.existsSync(XML))throw Error('previous_activation_artifacts_exist');
    if(execute(TASK_EXE,['/Query','/TN',TASK],10000).code===0)throw Error('activation_task_exists');
    const xml=scheduledXml({sid:principalSid(),node:process.execPath,script:SCRIPT});
    // Do not arm deployment; the new task executes in harmless probe mode first.
    fs.writeFileSync(PROBE_REQUEST,JSON.stringify({mode:'probe',version:1}),{flag:'wx',mode:0o600});
    fs.writeFileSync(XML,Buffer.concat([Buffer.from([255,254]),Buffer.from(xml,'utf16le')]),{flag:'wx'});
    const reg=execute(TASK_EXE,['/Create','/TN',TASK,'/XML',XML],24000);
    if(reg.code!==0)throw Error('scheduler_registration_failed:'+reg.err.slice(0,230));
    verifyTask();
    console.log(JSON.stringify({state:'PREPARED_UNARMED',task:TASK,check:details.slice(0,350)}));
    return;
  }
  if(action==='--probe'){
    verifyTask();mustExist(PROBE_REQUEST);
    if(fs.existsSync(PROBE_RESULT)||fs.existsSync(ARM))throw Error('probe_already_started');
    const r=execute(TASK_EXE,['/Run','/TN',TASK],15000);
    if(r.code!==0)throw Error('probe_task_not_started');
    for(let i=0;i<22;i++){
      await new Promise(done=>setTimeout(done,1000));
      const p=readJson(PROBE_RESULT);
      if(p?.state==='INDEPENDENT_PASS'&&p.pid>0) {
        console.log(JSON.stringify({state:'SCHEDULER_INDEPENDENT_PASS',pid:p.pid}));return;
      }
    }
    throw Error('independent_probe_not_confirmed');
  }
  if(action==='--arm'){
    verifyTask();
    const result=readJson(PROBE_RESULT);
    if(result?.state!=='INDEPENDENT_PASS'||!Number.isSafeInteger(result?.at)||
       Date.now()-result.at>10*60_000||Date.now()<result.at||!fs.existsSync(PROBE_REQUEST)||
       fs.existsSync(ARM))throw Error('no_fresh_verified_probe');
    preflight();
    fs.writeFileSync(ARM,JSON.stringify({version:1,mode:'deploy',probePid:result.pid}),{flag:'wx',mode:0o600});
    fs.unlinkSync(PROBE_REQUEST);
    console.log(JSON.stringify({state:'ARMED',task:TASK,probePid:result.pid}));
    return;
  }
  if(action==='--start'){
    verifyTask();
    mustExist(ARM);mustExist(PROBE_RESULT);
    if(fs.existsSync(PROBE_REQUEST))throw Error('still_in_probe_mode');
    preflight();
    const r=execute(TASK_EXE,['/Run','/TN',TASK],15000);
    if(r.code!==0)throw Error('activation_task_not_started');
    console.log(JSON.stringify({state:'OS_OWNED_ACTIVATION_REQUESTED',task:TASK,verified:false}));
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(e=>{console.error('NEXUS_OS_UPDATE_STOP:'+String(e.message||e).slice(0,350));process.exitCode=20;});
}
