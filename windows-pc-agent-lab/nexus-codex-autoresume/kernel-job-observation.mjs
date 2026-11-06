// Exact-binary read-only Win32 named Job observation.
// No recovery commands, no budget claims, no Scheduler or Codex calls.
// "NOT_FOUND" is evidence to investigate, NEVER authorization to resume.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const stop=reason=>Object.freeze({decision:'STOP',reason});
const ID=/^[A-Za-z0-9_-]{1,48}$/;
const SHA=/^[a-f0-9]{64}$/;
export async function observeKernelJob({root,taskId,nativeExe,expectedSha256}={}){
  if(process.platform!=='win32')return stop('WINDOWS_ONLY');
  if(typeof root!=='string'||!path.isAbsolute(root)||
     !path.basename(root).startsWith('nexus-job-test-')||
     typeof taskId!=='string'||!ID.test(taskId)||
     typeof nativeExe!=='string'||!path.isAbsolute(nativeExe)||
     path.extname(nativeExe).toLowerCase()!=='.exe'||
     typeof expectedSha256!=='string'||!SHA.test(expectedSha256))
    return stop('PROBE_INPUT_INVALID');
  try{
    const stat=await fs.lstat(nativeExe);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>5_000_000||stat.size<10000)
      return stop('PROBE_EXECUTABLE_UNSAFE');
    const sha=crypto.createHash('sha256').update(await fs.readFile(nativeExe)).digest('hex');
    if(sha!==expectedSha256)return stop('PROBE_BINARY_MISMATCH');
    // The hash must come from trusted deployment metadata, never the task's
    // state directory. Invoking the pinned helper creates NO worker process.
    const {stdout,stderr}=await exec(nativeExe,['probe',taskId,root],{
      timeout:7000,windowsHide:true,maxBuffer:4096
    });
    if(stderr.trim()||stdout.length>256)return stop('PROBE_OUTPUT_INVALID');
    const result=JSON.parse(stdout.trim());
    if(result&&result.status==='PRESENT'&&result.authorization==='NONE'&&
       Number.isSafeInteger(result.active)&&result.active>=0&&
       Object.keys(result).length===3)
      return Object.freeze({decision:'STOP',reason:'JOB_OBJECT_STILL_PRESENT',active:result.active});
    if(result&&result.status==='NOT_FOUND'&&result.authorization==='NONE'&&
       Object.keys(result).length===2)
      return Object.freeze({decision:'OS_OBSERVATION_ONLY',
        reason:'JOB_NOT_FOUND_IN_CURRENT_SESSION',canResume:false});
    return stop('PROBE_OUTPUT_UNTRUSTED');
  }catch{return stop('PROBE_FAILED_OR_UNCERTAIN');}
}
