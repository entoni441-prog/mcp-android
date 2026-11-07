#!/usr/bin/env node
/** One-time installer for the independent NEXUS Host recovery watchdog.
 * Owner approved; runs only AFTER existing NEXUS Host has been safely restored.
 * No elevation, no password, no Windows security policy change, no overwrites.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const SOURCE=path.dirname(fileURLToPath(import.meta.url));
const DEST=path.join(os.homedir(),'Documents','NEXUS','recovery-watchdog');
const NAME='NEXUS-Recovery-Independent';
const TASK_EXE=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','schtasks.exe');
const WHOAMI=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','whoami.exe');
const NAMES=['recovery-policy.mjs','recovery-watchdog.mjs'];
function esc(s){return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');}
export function makeTaskXml({sid,node,script,start}){
  if(!/^S-1-5-21-(?:\d+-){3}\d+$/.test(sid))throw Error('bad_user_sid');
  if(!path.win32.isAbsolute(node)||!node.toLowerCase().endsWith('\\node.exe'))throw Error('bad_node');
  if(!path.win32.isAbsolute(script)||!script.toLowerCase().endsWith('\\recovery-watchdog.mjs'))throw Error('bad_script');
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(start))throw Error('bad_date');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
 <RegistrationInfo><Description>NEXUS independent recovery. Start only verified existing Host scheduled task. No remote commands.</Description></RegistrationInfo>
 <Triggers>
   <CalendarTrigger><Repetition><Interval>PT1M</Interval><Duration>P1D</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
     <StartBoundary>${start}</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>
   <LogonTrigger><Enabled>true</Enabled><UserId>${esc(sid)}</UserId></LogonTrigger>
 </Triggers>
 <Principals><Principal id="Owner"><UserId>${esc(sid)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
 <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><StartWhenAvailable>true</StartWhenAvailable>
  <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
  <ExecutionTimeLimit>PT45S</ExecutionTimeLimit><Enabled>true</Enabled></Settings>
 <Actions Context="Owner"><Exec><Command>${esc(node)}</Command>
  <Arguments>&quot;${esc(script)}&quot; --once</Arguments>
  <WorkingDirectory>${esc(path.win32.dirname(script))}</WorkingDirectory></Exec></Actions>
</Task>`;
}
function sid(){
  const out=execFileSync(WHOAMI,['/user','/fo','csv','/nh'],{encoding:'utf8',timeout:8000,windowsHide:true});
  const found=String(out).match(/S-1-5-21-(?:\d+-){3}\d+/);
  if(!found)throw Error('no_owner_sid');
  return found[0];
}
function localTime(){
 const d=new Date();
 const p=x=>String(x).padStart(2,'0');
 return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
}
function verifySource(){
 for(const name of NAMES){
  const f=path.join(SOURCE,name);
  const t=fs.lstatSync(f);
  if(!t.isFile()||t.isSymbolicLink()||t.size>100000)throw Error('unsafe_source:'+name);
 }
}
function taskExists(){
 const r=spawnSync(TASK_EXE,['/Query','/TN',NAME],{windowsHide:true,encoding:'utf8',timeout:10000});
 return r.status===0;
}
function run(){
 if(process.platform!=='win32')throw Error('windows_only');
 const arg=process.argv[2];
 if(!['--check','--install','--resume'].includes(arg)||process.argv.length!==3)throw Error('arg');
 verifySource();
 const exists=fs.existsSync(DEST);
 if(taskExists())throw Error('existing_rescue_task');
 if(arg!=='--resume'&&exists)throw Error('existing_rescue_directory');
 if(arg==='--resume'&&!exists)throw Error('missing_partial_install');
 const owner=sid();
 if(!fs.existsSync(process.execPath)||!process.execPath.toLowerCase().endsWith('node.exe'))throw Error('node_not_signed_runtime');
 const script=path.win32.join(DEST,'recovery-watchdog.mjs');
 const xml=makeTaskXml({sid:owner,node:process.execPath,script,start:localTime()});
 if(arg==='--check'){console.log(JSON.stringify({state:'RECOVERY_PREFLIGHT_PASS',task:NAME,ownerSidVerified:true,limited:true}));return;}
 const file=path.join(DEST,'recovery-task.xml');
 let taskXml=xml;
 if(arg==='--resume'){
   const files=fs.readdirSync(DEST).sort();
   if(JSON.stringify(files)!==JSON.stringify([...NAMES,'recovery-task.xml'].sort()))throw Error('unexpected_existing_files');
   for(const name of NAMES){
     const old=fs.readFileSync(path.join(DEST,name)),fresh=fs.readFileSync(path.join(SOURCE,name));
     if(!old.equals(fresh))throw Error('partial_install_source_mismatch:'+name);
   }
   const oldXml=fs.readFileSync(file,'utf8');
   const time=oldXml.match(/<StartBoundary>([^<]+)<\/StartBoundary>/)?.[1];
   if(!time)throw Error('unverified_partial_xml');
   const expected=makeTaskXml({sid:owner,node:process.execPath,script,start:time});
   if(oldXml!==expected.replace('encoding="UTF-16"','encoding="UTF-8"'))
     throw Error('partial_xml_changed');
   taskXml=expected;
 } else {
   fs.mkdirSync(DEST,{recursive:false});
   for(const name of NAMES)fs.copyFileSync(path.join(SOURCE,name),path.join(DEST,name),fs.constants.COPYFILE_EXCL);
 }
 const blob=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(taskXml,'utf16le')]);
 fs.writeFileSync(file,blob);
 const reg=spawnSync(TASK_EXE,['/Create','/TN',NAME,'/XML',file],{windowsHide:true,encoding:'utf8',timeout:20000});
 if(reg.status!==0)throw Error('schedule_registration_failed:'+String(reg.stderr||'').slice(0,350));
 const verify=execFileSync(TASK_EXE,['/Query','/TN',NAME,'/XML'],
   {windowsHide:true,encoding:'utf8',timeout:10000});
 if(!String(verify).includes('recovery-watchdog.mjs')||!String(verify).includes('InteractiveToken'))
   throw Error('scheduler_identity_unverified');
 console.log(JSON.stringify({state:'TASK_REGISTERED_VERIFIED',task:NAME,taskRunsUnderOwner:true,limited:true,notes:'Host is not modified'}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{run();}catch(e){console.error('RECOVERY_INSTALL_STOP:'+String(e?.message||'unknown'));process.exitCode=20;}
}
