// Strictly isolated Windows Job-owned real Codex CLI fixture.
// NEVER enables Guardian recovery; all Codex invocations are read-only and
// relate to ONE newly created test UUID. No external file-changing operation.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {prepareOperation} from '../operation-journal.mjs';

const exec=promisify(execFile),root=process.argv[2],mode=process.argv[3];
if(process.platform!=='win32'||process.argv.length!==4||mode!=='real-readonly'||
   typeof root!=='string'||!path.isAbsolute(root)||
   !path.basename(root).startsWith('nexus-job-test-'))process.exit(64);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const digest=async p=>crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex');
async function exclusive(file,text){
  const h=await fs.open(file,'wx',0o600);
  try{await h.writeFile(text);await h.sync();}finally{await h.close();}
}
let task;
const status=async reason=>{
  try{await exclusive(path.join(root,'real-job-error.json'),
    JSON.stringify({status:'STOP',reason,taskId:task||null}));}catch{}
};
const heartbeat=path.join(root,'heartbeat-'+process.pid+'.txt');
let timer,child;
try{
  // Check the actual native OS owner, child and task identity before Codex
  // is even considered. The proof is produced by the native suspended Job.
  let native;
  for(let n=0;n<80;n++){
    try{
      const v=JSON.parse(await fs.readFile(path.join(root,'job-host-status.json'),'utf8'));
      const epoch=JSON.parse(await fs.readFile(path.join(root,'native-epoch-000.json'),'utf8'));
      const budget=JSON.parse(await fs.readFile(path.join(root,'budget-anchor.json'),'utf8'));
      if(v.status==='RUNNING'&&v.ownerPid===process.ppid&&v.childPid===process.pid&&
         v.jobActive>=1&&v.taskId===epoch.taskId&&v.ownerPid===epoch.ownerPid&&
         budget.taskId===v.taskId&&budget.maxAttempts===5){
        native=v;break;
      }
    }catch{}
    await sleep(35);
  }
  if(!native)throw Error('OS_OWNER_UNVERIFIED');
  task=native.taskId;
  if(typeof task!=='string'||!/^[A-Za-z0-9_-]{1,48}$/.test(task))
    throw Error('OS_TASK_INVALID');
  const binding=JSON.parse(await fs.readFile(path.join(root,'real-codex-binding.json'),'utf8'));
  if(!binding||Object.keys(binding).sort().join(',')!=='exe,sha256'||
     typeof binding.exe!=='string'||!path.isAbsolute(binding.exe)||
     path.basename(binding.exe).toLowerCase()!=='codex.exe'||
     !/[\\/]AppData[\\/]Local[\\/]OpenAI[\\/]Codex[\\/]bin[\\/]/i.test(binding.exe)||
     !/^[a-f0-9]{64}$/.test(binding.sha256)||
     (await digest(binding.exe))!==binding.sha256)throw Error('REAL_CODEX_BINDING_INVALID');

  const state=path.join(root,'state'),owner=path.join(root,'owner'),repo=path.join(root,'repo');
  await Promise.all([state,owner,repo].map(p=>fs.mkdir(p)));
  // A fresh local Git repo is required by Codex; never use a user checkout.
  await exec('git',['init','-b','isolated-test'],{cwd:repo,timeout:10000,windowsHide:true});
  await fs.writeFile(heartbeat,String(Date.now()));
  timer=setInterval(async()=>{try{await fs.writeFile(heartbeat,String(Date.now()));}catch{}},100);

  const start=(args,onEvent)=>{
    const p=spawn(binding.exe,args,{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe']});
    child=p;
    let buffer='',events=[],err='',closed=false;
    p.stderr.on('data',chunk=>{err=(err+chunk.toString()).slice(-1000);});
    p.stdout.on('data',chunk=>{
      buffer+=chunk.toString();
      if(buffer.length>160000){p.kill('SIGKILL');return;}
      while(buffer.includes('\n')){
        const i=buffer.indexOf('\n'),line=buffer.slice(0,i);buffer=buffer.slice(i+1);
        let e;try{e=JSON.parse(line);}catch{continue;}
        events.push(e);void onEvent?.(e,p);
      }
    });
    const ended=new Promise(resolve=>{
      p.once('exit',(code,signal)=>resolve({code,signal}));
      p.once('error',e=>resolve({error:e.code||'CODEX_SPAWN_ERROR'}));
    });
    return {p,events,ended,get stderr(){return err;}};
  };
  const baseline=start(['exec','--json','--sandbox','read-only','-C',repo,
    'This is an isolated read-only native Job diagnostic. Do not use tools and do not modify files. Reply exactly NEXUS-NATIVE-CODEX-BASELINE.']);
  const waitExit=async promise=>{
    let t;
    try{return await Promise.race([promise,new Promise((_,reject)=>{
      t=setTimeout(()=>reject(Error('CLI_TIMEOUT')),45000);
    })]);}finally{clearTimeout(t);}
  };
  const initial=await waitExit(baseline.ended);
  await sleep(150);baseline.p.stdout.destroy();baseline.p.stderr.destroy();baseline.p.unref();
  const thread=baseline.events.find(e=>e.type==='thread.started')?.thread_id;
  const baselineCompleted=initial.code===0&&UUID.test(thread)&&
    baseline.events.some(e=>e.type==='turn.completed')&&
    baseline.events.some(e=>e.type==='item.completed'&&e.item?.type==='agent_message'&&
      e.item.text?.includes('NEXUS-NATIVE-CODEX-BASELINE'));
  if(!baselineCompleted)throw Error('REAL_CODEX_BASELINE_UNCONFIRMED');
  if((await digest(binding.exe))!==binding.sha256)throw Error('CODEX_BINARY_CHANGED');
  await prepareOperation(state,{taskId:task,operationId:'local_effect_001',epoch:0});
  await exclusive(path.join(state,'state.json'),JSON.stringify({
    taskId:task,threadId:thread,status:'RUNNING',attempt:0,recordedStatus:null,childPid:null
  }));
  await exclusive(path.join(root,'real-readonly-ready.json'),JSON.stringify({
    taskId:task,threadId:thread,readOnly:true,baselineCompleted:true,guardianStarted:false,
    noFilesystemEffect:true
  }));
  const resume=start(['exec','resume','--json','-c','sandbox_mode="read-only"',
    thread,'This is an isolated native Job crash diagnostic. Do not use tools, do not modify any files. Explain Windows process handles and Job Objects in about 1200 words.'],
    async(e,p)=>{
      if(e.type==='turn.started'){
        try{
          await exclusive(path.join(root,'real-readonly-turn-started.json'),JSON.stringify({
            taskId:task,threadId:thread,pid:p.pid,turnStarted:true
          }));
        }catch{}
      }
    });
  // The runner kills ONLY the native parent after the exact second turn starts.
  // If that turn finishes on its own first, fail rather than faking a crash.
  const unexpected=await resume.ended;
  await status(unexpected.code===0?'SECOND_TURN_COMPLETED_BEFORE_INJECTION':'CODEX_SECOND_TURN_EXITED');
  process.exit(70);
}catch(e){
  await status(['OS_OWNER_UNVERIFIED','OS_TASK_INVALID','REAL_CODEX_BINDING_INVALID',
    'REAL_CODEX_BASELINE_UNCONFIRMED','CODEX_BINARY_CHANGED','CLI_TIMEOUT'].includes(e.message)
    ?e.message:'REAL_CODEX_FIXTURE_ERROR');
  if(child)try{child.kill('SIGKILL');}catch{}
  process.exit(71);
}finally{if(timer)clearInterval(timer);}
