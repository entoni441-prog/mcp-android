/** Windows PC Agent v3 — explicit, bounded task executor. No dynamic shell commands. */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

export const ACTIONS = Object.freeze(['get_status','list_dir','read_text','write_text','make_dir','open_app']);
const MAX_TEXT=8192;
const isObject=x=>x!==null && typeof x==='object' && !Array.isArray(x);
const keys=(x,required,optional=[])=>isObject(x)&&required.every(k=>Object.hasOwn(x,k))&&Object.keys(x).every(k=>[...required,...optional].includes(k));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
// Windows device aliases are not ordinary filenames, even with an extension.
const RESERVED_WINDOWS_NAME=/^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\..*)?$/i;
const safePath=s=>typeof s==='string'&&s.length<=240&&!s.includes('\0')&&!s.includes(':')&&!path.isAbsolute(s)&&!s.startsWith('\\')&&!s.startsWith('/')&&!s.includes('\\')&&s.split('/').length<=9&&s.split('/').every(t=>t!=='.'&&t!=='..'&&t!==''&& !RESERVED_WINDOWS_NAME.test(t) && !/[<>|?*"\x00-\x1f]/.test(t) && !/[. ]$/.test(t));
function requireRoot(root){
  if(typeof root!=='string'||!path.isAbsolute(root))throw Error('invalid_root');
  fs.mkdirSync(root,{recursive:true});
  const st=fs.lstatSync(root);
  if(!st.isDirectory()||st.isSymbolicLink())throw Error('invalid_root');
  return fs.realpathSync.native(root);
}
function targetPath(root,relative,allowRoot=false){
  if(allowRoot && relative==='')return root;
  if(!safePath(relative))throw Error('invalid_path');
  const full=path.resolve(root,...relative.split('/'));
  if(full===root||!full.startsWith(root+path.sep))throw Error('path_escape');
  let p=root;
  for(const chunk of relative.split('/')){
    p=path.join(p,chunk);
    if(fs.existsSync(p)){
      const st=fs.lstatSync(p);
      if(st.isSymbolicLink())throw Error('symlink_forbidden');
      const real=fs.realpathSync.native(p);
      if(real!==root&&!real.startsWith(root+path.sep))throw Error('path_escape');
    }
  }
  return full;
}
function textFile(full){
  const st=fs.lstatSync(full);
  if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_TEXT)throw Error('not_small_regular_file');
  const data=fs.readFileSync(full);
  if(data.includes(0))throw Error('binary_forbidden');
  const decoded=new TextDecoder('utf-8',{fatal:true}).decode(data);
  return {text:decoded,sha256:sha(data)};
}
export function validateJob(action,args){
  if(!ACTIONS.includes(action)||!isObject(args))throw Error('invalid_action');
  if(action==='get_status' && !keys(args,[]))throw Error('invalid_args');
  if(action==='list_dir' && (!keys(args,['path'])||!(args.path===''||safePath(args.path))))throw Error('invalid_args');
  if(action==='read_text' && (!keys(args,['path'])||!safePath(args.path)))throw Error('invalid_args');
  if(action==='make_dir' && (!keys(args,['path'])||!safePath(args.path)))throw Error('invalid_args');
  if(action==='write_text' && (!keys(args,['path','content','expectedSha256'])||!safePath(args.path)||typeof args.content!=='string'||Buffer.byteLength(args.content,'utf8')>MAX_TEXT||!(args.expectedSha256===null||(/^[a-f0-9]{64}$/.test(args.expectedSha256)))))throw Error('invalid_args');
  if(action==='open_app' && (!keys(args,['app'])||!['notepad','calculator'].includes(args.app)))throw Error('invalid_args');
  return true;
}
export async function executeJob(action,args,{workspace,platform=process.platform,launcher=spawn}={}){
  validateJob(action,args);
  const root=requireRoot(workspace);
  switch(action){
    case 'get_status':return {uptimeSeconds:Math.floor(os.uptime()),ramTotalGb:+(os.totalmem()/2**30).toFixed(1),ramFreeGb:+(os.freemem()/2**30).toFixed(1),platform:os.platform(),arch:os.arch()};
    case 'list_dir':{
      const dir=targetPath(root,args.path,true);
      if(!fs.statSync(dir).isDirectory())throw Error('not_directory');
      const entries=fs.readdirSync(dir,{withFileTypes:true}).slice(0,100).filter(x=>!x.isSymbolicLink()).map(x=>({name:x.name,type:x.isDirectory()?'directory':x.isFile()?'file':'other'}));
      return {path:args.path,entries,truncated:fs.readdirSync(dir).length>100};
    }
    case 'read_text':return {path:args.path,...textFile(targetPath(root,args.path))};
    case 'make_dir':{
      const dir=targetPath(root,args.path);
      if(fs.existsSync(dir))throw Error('already_exists');
      const parent=path.dirname(dir);
      if(!fs.existsSync(parent)||!fs.statSync(parent).isDirectory())throw Error('parent_missing');
      fs.mkdirSync(dir);return {path:args.path,created:true};
    }
    case 'write_text':{
      const full=targetPath(root,args.path);
      const parent=path.dirname(full);
      if(!fs.existsSync(parent)||!fs.statSync(parent).isDirectory())throw Error('parent_missing');
      if(args.expectedSha256===null){
        fs.writeFileSync(full,args.content,{flag:'wx',encoding:'utf8',mode:0o600});
        return {created:true,path:args.path,sha256:sha(Buffer.from(args.content,'utf8'))};
      }
      const existing=textFile(full);
      if(existing.sha256!==args.expectedSha256)throw Error('conflict');
      // Temp file and rename reduce partial-write risk; this is NOT a multi-writer transactional filesystem.
      const temp=path.join(parent,'.pcagent-'+crypto.randomBytes(8).toString('hex')+'.tmp');
      try{
        fs.writeFileSync(temp,args.content,{flag:'wx',encoding:'utf8',mode:0o600});
        fs.renameSync(temp,full);
      }finally{if(fs.existsSync(temp))fs.rmSync(temp,{force:true});}
      return {created:false,path:args.path,sha256:sha(Buffer.from(args.content,'utf8'))};
    }
    case 'open_app':{
      if(platform!=='win32')throw Error('windows_only');
      const exe=args.app==='notepad'?'notepad.exe':'calc.exe';
      const proc=launcher(exe,[],{detached:true,stdio:'ignore',windowsHide:false});
      // spawn() may fail asynchronously (ENOENT, permissions). Never report success first.
      await new Promise((resolve,reject)=>{
        proc.once('error',()=>reject(Error('app_launch_failed')));
        proc.once('spawn',resolve);
      });
      proc.unref?.();return {started:true,app:args.app};
    }
  }
}
