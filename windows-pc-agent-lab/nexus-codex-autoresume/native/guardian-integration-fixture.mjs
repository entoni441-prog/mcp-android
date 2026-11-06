// Strictly experimental full-chain test: actual Guardian 0.3 -> controller 0.2 ->
// existing fake-codex. Never launches a real Codex binary, performs network calls,
// touches NEXUS production, or attempts to recover an unknown IN_FLIGHT effect.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {runGuardian} from '../guardian.mjs';

const exec=promisify(execFile), root=process.argv[2], mode=process.argv[3];
const exact=process.argv.length===4 && typeof root==='string' && path.isAbsolute(root)
  && path.basename(root).startsWith('nexus-job-test-') && ['normal','hang'].includes(mode)
  && path.relative(path.resolve(process.env.TEMP||''),root).split(path.sep)[0]!=='..';
if(!exact)process.exit(64);

const state=path.join(root,'state'),owner=path.join(root,'owner'),repo=path.join(root,'repo');
const fake=fileURLToPath(new URL('../fake-codex.mjs',import.meta.url));
const save=async(name,obj)=> {
  const tmp=path.join(root,name+'.'+crypto.randomUUID()+'.tmp');
  await fs.writeFile(tmp,JSON.stringify(obj));
  await fs.rename(tmp,path.join(root,name));
};
const claim=await fs.open(path.join(root,'integration-run-claim.json'),'wx',0o600).catch(()=>null);
if(!claim){console.log(JSON.stringify({status:'STOP',reason:'INTEGRATION_ALREADY_CLAIMED'}));process.exit(20);}
await claim.writeFile(JSON.stringify({testOnly:true,runPid:process.pid}));
await claim.sync();await claim.close();

await Promise.all([state,owner,repo].map(p=>fs.mkdir(p)));
await exec('git',['init','-b','isolated-test'],{cwd:repo,timeout:12000,windowsHide:true});
await fs.writeFile(path.join(repo,'.git','info','exclude'),'mock.json\n');
await fs.writeFile(path.join(repo,'mock.json'),JSON.stringify({
  stateDirectory:state,taskId:'guardian-integration-task',mode:mode==='normal'?'success':'hold'
}));
const sha=crypto.createHash('sha256').update(await fs.readFile(process.execPath)).digest('hex');
const m={taskId:'guardian-integration-task',approved:true,workingDirectory:repo,
  codexExe:process.execPath,codexSha256:sha,expectedBranch:'isolated-test',
  stateDirectory:state,initialPrompt:'TEST_ONLY_NO_EXTERNAL_ACTIONS',
  resumePrompt:'TEST_ONLY_NO_EXTERNAL_ACTIONS',maxResumes:1,completionFile:path.join(state,'complete.json')
};
const hb=path.join(root,'heartbeat-'+process.pid+'.txt');
let alive=true, observed=false;
const heartbeat=setInterval(async()=>{
  if(alive)try{await fs.writeFile(hb,String(Date.now()));}catch{}
},100);
await fs.writeFile(hb,String(Date.now()));

const live=async()=>{
  try{
    const s=JSON.parse(await fs.readFile(path.join(state,'state.json'),'utf8'));
    const p=JSON.parse(await fs.readFile(path.join(state,'guardian-process.json'),'utf8'));
    const c=JSON.parse(await fs.readFile(path.join(state,'checkpoint.json'),'utf8'));
    return s.status==='RUNNING'&&typeof s.threadId==='string'&&s.childPid===c.pid&&
      Number.isSafeInteger(p.controllerPid)&&p.controllerPid!==c.pid;
  }catch{return false;}
};
let hanging;
if(mode==='hang')hanging=setInterval(async()=>{
  if(!observed&&await live()){
    observed=true;
    await save('hang-observed.json',{controllerAndCliAlive:true,guardianPid:process.pid});
    // Simulates an unresponsive Guardian while its *real controller and mock
    // Codex child remain alive*. The native kernel Job watchdog must terminate
    // the entire tree, without trusting any discovered PID.
    alive=false;clearInterval(heartbeat);clearInterval(hanging);
  }
},50);

try{
  const r=await runGuardian(m,{
    testScript:fake,ownerDirectory:owner,initialTimeoutMs:35000,
    orphanWaitMs:1500,resumeTimeoutMs:12000
  });
  alive=false;clearInterval(heartbeat);if(hanging)clearInterval(hanging);
  await save('integration-result.json',r);
  process.exit(r.status==='COMPLETED'?0:21);
}catch{
  alive=false;clearInterval(heartbeat);if(hanging)clearInterval(hanging);
  await save('integration-result.json',{status:'STOP',reason:'TEST_RUNTIME_ERROR'});
  process.exit(22);
}
