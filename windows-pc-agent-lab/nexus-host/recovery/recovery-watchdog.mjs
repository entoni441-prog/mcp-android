#!/usr/bin/env node
/** NEXUS Recovery Watchdog v1 — an independent ONE-SHOT Windows Scheduled Task.
 * Runs every minute under owner's interactive Windows identity, outside the
 * NEXUS Host/Supervisor process tree and their Job Object.
 *
 * Can ONLY run the preexisting, identity-verified NEXUS-Host-Run task.
 * Cannot execute model-defined commands, update code, power cycle, login,
 * manipulate Windows security settings, or remove owner's NEXUS host-off.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {decideRecovery} from './recovery-policy.mjs';

const TASK='NEXUS-Host-Run';
const INSTALLED=path.win32.join(os.homedir(),'Documents','NEXUS','nexus-host','nexus.mjs');
const ROOT=path.join(os.homedir(),'NEXUS-workspace','nexus-recovery-independent');
const STOP=path.join(os.homedir(),'.nexus-host','host-off');
const PIDFILE=path.join(os.homedir(),'.nexus-host','host.pid');
const SUPERVISOR_PIDFILE=path.join(os.homedir(),'.nexus-host','supervisor.pid');
const STATE=path.join(ROOT,'state.json');
const SUMMARY=path.join(ROOT,'summary.json');
const schtasks=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','schtasks.exe');
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function atomicJson(file,obj){
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';
  const fd=fs.openSync(tmp,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(obj)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(tmp,file);
}
function alive(pid){
  if(!Number.isSafeInteger(pid)||pid<1)return false;
  try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}
}
async function healthy(){
  try{
    const r=await fetch('http://127.0.0.1:8765/healthz',{signal:AbortSignal.timeout(1800)});
    if(!r.ok)return false;
    const j=await r.json();
    return j?.ok===true;
  }catch{return false;}
}
/** Exact Task Scheduler action identity; reject extra Node flags and unknown scripts. */
export function verifyTaskXml(xml,expectedScript=INSTALLED){
  if(typeof xml!=='string')return false;
  const cmd=xml.match(/<Command>([^<]+)<\/Command>/i)?.[1]?.trim();
  const raw=xml.match(/<Arguments>([^<]+)<\/Arguments>/i)?.[1]?.trim();
  if(!cmd||!raw)return false;
  const exe=cmd.replace(/&quot;/gi,'"').replace(/^"|"$/g,'');
  const args=raw.replace(/&quot;/gi,'"').trim().replace(/^"|"$/g,'');
  return /(?:^|[\\/])node\.exe$/i.test(exe) &&
    args.replace(/\//g,'\\').toLowerCase()===expectedScript.replace(/\//g,'\\').toLowerCase();
}
function taskIdentity(){
  try{
    const xml=execFileSync(schtasks,['/Query','/TN',TASK,'/XML'],
      {windowsHide:true,timeout:9000,encoding:'utf8',maxBuffer:120_000});
    return verifyTaskXml(String(xml));
  }catch{return false;}
}
function persistStatus(action,details={}){
  atomicJson(SUMMARY,{version:1,at:new Date().toISOString(),action,
    service:'NEXUS-Recovery-Watchdog',...details});
}
export async function runOnce(){
  if(process.platform!=='win32')throw Error('WINDOWS_ONLY');
  fs.mkdirSync(ROOT,{recursive:true});
  const now=Date.now();
  // One action per minute, including simultaneous manual invocation; this
  // never holds a persistent lock beyond the minute or blocks crash recovery.
  const minute=path.join(ROOT,'run-'+Math.floor(now/60000)+'.once');
  let fd;
  try{fd=fs.openSync(minute,'wx',0o600);fs.writeSync(fd,String(now));fs.fsyncSync(fd);}
  catch(e){if(e.code==='EEXIST'){persistStatus('ALREADY_EVALUATED_THIS_MINUTE');return;}throw e;}
  finally{if(fd!==undefined)fs.closeSync(fd);}
  const hostOff=fs.existsSync(STOP);
  const isHealthy=await healthy();
  const rawPid=readJson(PIDFILE);
  // Corrupt durability state is never interpreted as "zero prior starts".
  const rawSupervisor=readJson(SUPERVISOR_PIDFILE);
  if((fs.existsSync(PIDFILE)&&(!rawPid||!Number.isSafeInteger(rawPid.pid)))||
     (fs.existsSync(SUPERVISOR_PIDFILE)&&(!rawSupervisor||!Number.isSafeInteger(rawSupervisor.pid)))||
     (fs.existsSync(STATE)&&readJson(STATE)===null)){
    persistStatus('CORRUPT_STATE_STOP');
    return;
  }
  const hostPid=rawPid?.pid;
  const hostAlive=alive(hostPid);
  const supervisorAlive=alive(rawSupervisor?.pid);
  const verified=hostOff||isHealthy||hostAlive||supervisorAlive?false:taskIdentity();
  const state=readJson(STATE)||{};
  const decision=decideRecovery({now,healthy:isHealthy,ownerOff:hostOff,
    existingHostAlive:hostAlive,supervisorAlive,taskVerified:verified,state});
  atomicJson(STATE,decision.next); // Durable budget BEFORE any start attempt.
  if(decision.action!=='START_EXISTING_TASK'){
    persistStatus(decision.action,{healthy:isHealthy,hostAlive,supervisorAlive,ownerOff:hostOff});
    return;
  }
  try{
    const out=execFileSync(schtasks,['/Run','/TN',TASK],
      {windowsHide:true,timeout:12_000,encoding:'utf8',maxBuffer:16_000});
    // Scheduler accepted != Host restored; subsequent runs verify real health.
    persistStatus('START_REQUESTED_UNVERIFIED',{attempts:decision.next.attempts.length});
  }catch{
    persistStatus('START_FAILED',{attempts:decision.next.attempts.length});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3||process.argv[2]!=='--once')process.exit(64);
  runOnce().catch(e=>{
    try{fs.mkdirSync(ROOT,{recursive:true});persistStatus('WATCHDOG_ERROR');}catch{}
    console.error('NEXUS_RECOVERY_STOP');
    process.exitCode=20;
  });
}
