// TEST-ONLY real Codex continuation inside a new, independently owned native
// epoch-1 Windows Job. This is NOT the disabled production "recover" command.
// Never chooses a session, edits a project, or retries an external IN_FLIGHT.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {getOperation} from '../operation-journal.mjs';
import {inspectRecoveryBudget} from '../recovery-budget.mjs';

const [root,mode]=process.argv.slice(2);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK=/^[A-Za-z0-9_-]{1,48}$/;
if(process.platform!=='win32'||process.argv.length!==4||mode!=='resume-readonly'||
   typeof root!=='string'||!path.isAbsolute(root)||
   !path.basename(root).startsWith('nexus-job-test-'))process.exit(64);
const sha=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const isPresent=async file=>fs.access(file).then(()=>true,()=>false);
const read=async file=>{
  const st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>3072)throw Error('RECEIPT_UNSAFE');
  return JSON.parse(await fs.readFile(file,'utf8'));
};
const emit=async obj=>{
  const h=await fs.open(path.join(root,'native-e1-readonly-result.json'),'wx',0o600);
  try{await h.writeFile(JSON.stringify(obj)+'\n');await h.sync();}finally{await h.close();}
};
let child=null,heartbeat=null,task=null;
try{
  // The suspended first child was assigned to the NEW Job before running.
  let owner;
  for(let n=0;n<90;n++){
    try{
      const row=await read(path.join(root,'job-host-status.json'));
      const epoch=await read(path.join(root,'native-epoch-001.json'));
      const assigned=await fs.readFile(path.join(root,'native-job-assigned-e1.txt'),'utf8');
      if(row.status==='RUNNING'&&row.ownerPid===process.ppid&&
         row.childPid===process.pid&&row.jobActive>=1&&
         row.taskId===epoch.taskId&&epoch.epoch===1&&
         epoch.ownerPid===row.ownerPid&&epoch.restartCount===1&&
         assigned.startsWith('taskId='+row.taskId+'\nownerPid='+row.ownerPid+'\n')&&
         assigned.includes('\nchildPid='+process.pid+'\n')&&
         assigned.includes('\njobAssigned=1\ninheritedHandles=0\nbreakaway=0\n')){
        owner=row;break;
      }
    }catch{}
    await delay(35);
  }
  if(!owner||!TASK.test(owner.taskId))throw Error('E1_NATIVE_OWNER_NOT_PROVEN');
  task=owner.taskId;
  const ready=await read(path.join(root,'real-readonly-ready.json'));
  const previous=await read(path.join(root,'state','state.json'));
  const binding=await read(path.join(root,'real-codex-binding.json'));
  const thread=ready.threadId;
  if(ready.taskId!==task||ready.baselineCompleted!==true||ready.readOnly!==true||
     ready.noFilesystemEffect!==true||ready.guardianStarted!==false||
     previous.taskId!==task||previous.threadId!==thread||
     previous.status!=='RUNNING'||previous.attempt!==0||
     !UUID.test(thread))throw Error('E1_EXACT_THREAD_UNVERIFIED');
  if(typeof binding.exe!=='string'||!path.isAbsolute(binding.exe)||
     path.basename(binding.exe).toLowerCase()!=='codex.exe'||
     !/[\\/]AppData[\\/]Local[\\/]OpenAI[\\/]Codex[\\/]bin[\\/]/i.test(binding.exe)||
     !/^[a-f0-9]{64}$/.test(binding.sha256)||
     (await sha(binding.exe))!==binding.sha256)throw Error('E1_CLI_BINARY_MISMATCH');
  if(await isPresent(path.join(root,'owner','owner-stop.json'))||
     await isPresent(path.join(root,'owner','host-off'))||
     await isPresent(path.join(root,'state','complete.json'))||
     await isPresent(path.join(root,'state','effect-once.txt')))
    throw Error('E1_OWNER_OR_EFFECT_STOP');
  const prior=await getOperation(path.join(root,'state'),{
    taskId:task,operationId:'local_effect_001',epoch:0
  });
  if(prior.stage!=='PREPARED')throw Error('E1_EXTERNAL_EFFECT_UNCERTAIN');
  const ledger=await inspectRecoveryBudget(root,task);
  if(ledger.decision!=='READY'||ledger.used!==1||ledger.remaining!==4)
    throw Error('E1_BUDGET_UNVERIFIED');
  heartbeat=path.join(root,'heartbeat-'+process.pid+'.txt');
  await fs.writeFile(heartbeat,String(Date.now()));
  const tick=setInterval(async()=>{try{await fs.writeFile(heartbeat,String(Date.now()));}catch{}},100);
  try{
    // This exact invocation is a read-only diagnostic continuation of the UUID
    // created by the e0 Job. It never uses the original prompt or workspace-write.
    child=spawn(binding.exe,['exec','resume','--json',
      '-c','sandbox_mode="read-only"',thread,
      'Read-only isolated recovery diagnostic: do not use tools or edit files. Reply exactly NEXUS-NATIVE-EPOCH1-RESUMED.'],{
      cwd:path.join(root,'repo'),windowsHide:true,stdio:['ignore','pipe','pipe']
    });
    let events=[],buffer='',bad=false,stderrKind='NONE';
    child.stderr.on('data',x=>{if(x.length)stderrKind='EMITTED';});
    child.stdout.on('data',x=>{
      buffer+=x.toString();
      if(buffer.length>160000){bad=true;child.kill('SIGKILL');return;}
      while(buffer.includes('\n')){
        const at=buffer.indexOf('\n'),line=buffer.slice(0,at);
        buffer=buffer.slice(at+1);
        try{events.push(JSON.parse(line));}catch{bad=true;}
      }
    });
    let clock;
    const outcome=await Promise.race([
      new Promise(resolve=>{
        child.once('exit',(code,signal)=>resolve({code,signal}));
        child.once('error',()=>resolve({error:true}));
      }),
      new Promise(resolve=>{clock=setTimeout(()=>resolve({timeout:true}),55000);})
    ]);
    clearTimeout(clock);
    await delay(160);
    if(outcome.timeout||outcome.error||outcome.code!==0||bad||
       !events.some(e=>e.type==='thread.started'&&e.thread_id===thread)||
       !events.some(e=>e.type==='turn.completed')||
       !events.some(e=>e.type==='item.completed'&&
         e.item?.type==='agent_message'&&e.item.text?.includes('NEXUS-NATIVE-EPOCH1-RESUMED')))
      throw Error('E1_RESUME_NOT_CONFIRMED');
    if(await isPresent(path.join(root,'state','effect-once.txt')))
      throw Error('E1_UNEXPECTED_EFFECT');
    await emit({status:'PASS',taskId:task,epoch:1,resumeSameThread:true,
      turnCompleted:true,readOnly:true,externalEffectReplayed:false,
      nativeOwned:true,stderrKind});
    process.exitCode=0;
  }finally{clearInterval(tick);}
}catch(e){
  const reason=String(e.message||'E1_UNEXPECTED_ERROR').slice(0,70);
  try{await emit({status:'STOP',taskId:task,epoch:1,reason});}catch{}
  process.exitCode=25;
}finally{
  if(child){try{child.kill('SIGKILL');}catch{}
    child.stdout?.destroy();child.stderr?.destroy();child.unref();}
}
