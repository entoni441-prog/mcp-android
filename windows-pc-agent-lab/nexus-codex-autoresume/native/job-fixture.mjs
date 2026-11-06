// Test-only child for Win32 Job Object acceptance. Never sends messages, edits
// external files, invokes Codex, or touches the production NEXUS runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const state=process.argv[2],mode=process.argv[3];
const fail=(msg)=>{process.stderr.write(msg+'\n');process.exitCode=1;};
if(!state||!path.isAbsolute(state)||!['normal','hold','hang','tree'].includes(mode)){
  fail('INVALID_TEST_ARGS');
} else {
  const atomic=async(filename,data)=>{
    const temp=filename+'.'+process.pid+'.tmp';
    await fs.writeFile(temp,JSON.stringify(data));
    await fs.rename(temp,filename);
  };
  const effect=path.join(state,'effect-once.txt');
  const operationId='job-fixture-effect-'+mode;
  try {
    const file=await fs.open(effect,'wx',0o600);
    try{await file.writeFile(operationId+'\n');await file.sync();}finally{await file.close();}
  }catch(e){if(e.code!=='EEXIST')throw e;fail('DUPLICATE_EFFECT');}
  await atomic(path.join(state,'fixture-status.json'),{pid:process.pid,mode,ready:true});
  const hb=path.join(state,'heartbeat-'+process.pid+'.txt');
  let ticks=0;
  const interval=setInterval(async()=>{
    try{
      ticks++;
      if(mode==='hang'&&ticks>5){clearInterval(interval);return;}
      await fs.writeFile(hb,String(Date.now()));
    }catch{}
  },100);
  await fs.writeFile(hb,String(Date.now()));

  if(mode==='tree'||mode==='hang'){
    const child=spawn(process.execPath,[fileURLToPath(new URL('./job-grandchild.mjs',import.meta.url)),state],{
      cwd:state,detached:true,windowsHide:true,stdio:'ignore'
    });
    child.unref();
    await atomic(path.join(state,'grandchild-spawned.json'),{pid:child.pid,spawnedBy:process.pid});
  }
  if(mode==='normal'){
    setTimeout(()=>{clearInterval(interval);process.exit(0);},1300);
  }else if(mode==='tree'){
    // Parent exits while detached grandchild is still alive. The owning job
    // must terminate and account for grandchild before marking job empty.
    setTimeout(()=>{clearInterval(interval);process.exit(0);},1600);
  }else if(mode==='hold'){
    setTimeout(()=>{clearInterval(interval);process.exit(0);},15000);
  }else if(mode==='hang'){
    // Keep the main process ALIVE with no heartbeat, and a detached child alive.
    setTimeout(()=>process.exit(0),70000);
  }
}
