// Test-only mock Codex. A unique local effect is journalled BEFORE execution.
// Never opens a network connection or makes an actual Codex API request.
// It intentionally leaves an uncertain IN_FLIGHT state in hold mode.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {prepareOperation,beginExternalOperation,confirmOperation,getOperation} from '../operation-journal.mjs';

const ID='019a8f9b-1452-71c0-8a17-6915a0904d67';
const args=process.argv.slice(2);
if(args[0]!=='exec'||!args.includes('--json'))process.exit(64);
const resume=args[1]==='resume';
const config=JSON.parse(await fs.readFile(path.join(process.cwd(),'mock.json'),'utf8'));
const {taskId,stateDirectory:state,mode}=config;
if(typeof taskId!=='string'||!/^[A-Za-z0-9_-]{1,48}$/.test(taskId)||!['success','hold'].includes(mode))process.exit(65);
const identity={taskId,operationId:'local_effect_001',epoch:0};
const marker=()=>fs.writeFile(path.join(state,'complete.json'),JSON.stringify({taskId,status:'completed'}));
if(resume){
  const operation=await getOperation(state,identity);
  // No blind retry after unknown external effect, even if the Codex thread exists.
  if(operation.stage!=='COMMITTED'){process.stdout.write(JSON.stringify({type:'turn.failed'})+'\n');process.exit(15);}
  if(args[3]!==ID)process.exit(16);
  await fs.writeFile(path.join(state,'resumed.json'),JSON.stringify({threadId:ID,pid:process.pid}));
  await marker();
  process.stdout.write(JSON.stringify({type:'turn.completed'})+'\n');
}else{
  process.stdout.write(JSON.stringify({type:'thread.started',thread_id:ID})+'\n');
  await prepareOperation(state,identity);
  await beginExternalOperation(state,identity);
  // This is the entire test's "external" effect: immutable local file,
  // safely scoped to its unique Temp state directory.
  const target=path.join(state,'effect-once.txt');
  const h=await fs.open(target,'wx',0o600);
  try{await h.writeFile('one test effect\n');await h.sync();}finally{await h.close();}
  const verified=(await fs.readFile(target,'utf8'))==='one test effect\n';
  if(mode==='success'&&verified){
    const digest=crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex');
    await confirmOperation(state,identity,{verified:true,externalId:digest});
  }
  await fs.writeFile(path.join(state,'checkpoint.json'),JSON.stringify({pid:process.pid,threadId:ID}));
  process.stdout.write(JSON.stringify({type:'mock.ready',pid:process.pid})+'\n');
  if(mode==='success'){
    await marker();
    process.stdout.write(JSON.stringify({type:'turn.completed'})+'\n');
  }else{
    setInterval(()=>{},1000);
  }
}
