// NEXUS Guardian — pre-reboot STANDBY monitor (no executor).
// Never launches Codex, edits production, accesses credentials or sends mail.
// Local watch root is explicitly scoped. A separate ChatGPT automation may
// poll the sanitized health/alert summary; no delivery is claimed here.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const args=process.argv.slice(2);
const opts={};
for(let i=0;i<args.length;i+=2){
  if(!['--root','--mode'].includes(args[i])||i+1>=args.length)process.exit(64);
  opts[args[i].slice(2)]=args[i+1];
}
const root=opts.root, mode=opts.mode;
const basename=typeof root==='string'?path.basename(root):'';
if(typeof root!=='string'||!path.isAbsolute(root)||
   !/^nexus-guardian-preboot-(?:watch|test-[a-f0-9]{8})$/.test(basename)||
   !['once','resident'].includes(mode)||args.length!==4)process.exit(64);
const ALLOWED=new Set(['OWNER_STOP','BUDGET_EXHAUSTED',
  'RECONCILIATION_REQUIRED','PROCESS_TREE_UNVERIFIED',
  'RECOVERY_NOT_ENABLED','NATIVE_RECOVERY_UNSAFE',
  'STABILITY_NOT_PROVEN','ENVIRONMENT_CHANGED',
  'SINGLE_INSTANCE_UNPROVEN','TASK_IDENTITY_UNPROVEN',
  'PRIOR_PROCESS_ALIVE','SESSION_UNVERIFIED',
  'EPOCH_INVALID','BUDGET_CORRUPT','UNKNOWN_STOP']);
const POLL_MS=3000;
const pathIn=(...parts)=>path.join(root,...parts);
const readSafe=async file=>{
  const st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>1024)throw Error('UNSAFE_INBOX');
  return JSON.parse(await fs.readFile(file,'utf8'));
};
async function atomically(file,value){
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';
  const f=await fs.open(tmp,'wx',0o600);
  try{await f.writeFile(JSON.stringify(value)+'\n');await f.sync();}
  finally{await f.close();}
  await fs.rename(tmp,file);
}
const startIso=new Date().toISOString();
let polls=0,lastError=null,quit=false;
const exists=async file=>fs.access(file).then(()=>true,()=>false);
async function poll(){
  polls++;
  const items=[];
  try{
    const entries=await fs.readdir(pathIn('outbox'));
    const notices=entries.filter(x=>x.startsWith('stop-notice-'));
    if(notices.length>100||notices.some(x=>!/^stop-notice-e\d{4}\.json$/.test(x)))
      throw Error('OUTBOX_UNKNOWN_FILE');
    for(const name of notices.sort()){
      const row=await readSafe(pathIn('outbox',name));
      const epoch=Number(name.slice(13,17));
      if(!row||row.version!==1||row.taskId!=='guardian_preboot'||
         row.epoch!==epoch||row.status!=='STOP'||!ALLOWED.has(row.reason)||
         Object.keys(row).length!==5)
        throw Error('OUTBOX_INVALID');
      items.push({id:name.slice(0,-5),reason:row.reason,epoch});
    }
    lastError=null;
  }catch(e){
    lastError=['OUTBOX_UNKNOWN_FILE','OUTBOX_INVALID','UNSAFE_INBOX'].includes(e.message)
      ?e.message:'OUTBOX_UNREADABLE';
  }
  const ownerStop=await exists(pathIn('owner-stop.json'));
  const summary={
    version:1,mode:'STANDBY_NO_EXECUTION',startedAt:startIso,
    updatedAt:new Date().toISOString(),pid:process.pid,polls,
    ownerStop,health:lastError?'STOP':ownerStop?'STOP':'OK',
    pending:items,reason:lastError|| (ownerStop?'OWNER_STOP':null),
    externalDelivery:'NOT_CONFIGURED',canResume:false
  };
  await atomically(pathIn('watch-summary.json'),summary);
  if(ownerStop)quit=true;
  return summary;
}
try{
  await fs.mkdir(root,{recursive:true});
  // Reject a redirect of the watched directory itself. CI runner's parent
  // Temp directory can be a junction/alias and need not stringify identically.
  const directory=await fs.lstat(root);
  if(!directory.isDirectory()||directory.isSymbolicLink())
    throw Error('WATCH_ROOT_REDIRECTED');
  await fs.mkdir(pathIn('outbox'),{recursive:true});
  do{
    const state=await poll();
    if(mode==='once'){console.log(JSON.stringify(state));break;}
    if(quit)break;
    await new Promise(resolve=>setTimeout(resolve,POLL_MS));
  }while(!quit);
}catch(e){
  console.error('PREBOOT_WATCH_STOP:'+String(e.message||'INTERNAL'));
  process.exitCode=20;
}
