import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export const digest=m=>crypto.createHash('sha256').update(JSON.stringify(m)).digest('hex');
export async function atomic(file,value){const tmp=file+'.'+crypto.randomUUID()+'.tmp';const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(JSON.stringify(value));await h.sync();}finally{await h.close();}await fs.rename(tmp,file);try{const d=await fs.open(path.dirname(file),'r');try{await d.sync();}finally{await d.close();}}catch{ /* directory fsync may be unsupported */ }}
export async function identity(pid){
 if(!Number.isSafeInteger(pid)||pid<1)throw Error('PROCESS_UNCERTAIN');
 if(process.platform==='win32'){
 const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop; if($p){[pscustomobject]@{pid=$p.ProcessId;parent=$p.ParentProcessId;exe=$p.ExecutablePath;born=$p.CreationDate.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress}`],{timeout:10000,windowsHide:true}).catch(()=>{throw Error('PROCESS_UNCERTAIN')});
 if(!stdout.trim())return null;const p=JSON.parse(stdout);if(!p.exe||!p.born)throw Error('PROCESS_UNCERTAIN');return p;
 }
 try{const s=await fs.readFile(`/proc/${pid}/stat`,'utf8');const a=s.slice(s.lastIndexOf(')')+2).split(' ');if(a[0]==='Z')return null;return {pid,parent:Number(a[1]),exe:await fs.readlink(`/proc/${pid}/exe`),born:a[19]};}catch(e){if(e.code==='ENOENT')return null;throw Error('PROCESS_UNCERTAIN');}
}
export async function exited(record){if(!record?.born||!record.exe)throw Error('PROCESS_UNCERTAIN');const p=await identity(record.pid);if(!p)return true;if(p.born!==record.born) return true;if(p.exe!==record.exe)throw Error('PROCESS_UNCERTAIN');return false;}
