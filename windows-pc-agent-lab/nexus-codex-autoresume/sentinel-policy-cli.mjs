import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessRecovery} from './sentinel-policy.mjs';

export async function evaluateSnapshot(file) {
  if(typeof file!=='string'||!path.isAbsolute(file))return {decision:'STOP',reason:'ABSOLUTE_PATH_REQUIRED',execution:'NOT_PERFORMED'};
  try {
    const real=await fs.realpath(file);
    if(real!==path.resolve(file))return {decision:'STOP',reason:'SYMLINK_OR_ALIAS',execution:'NOT_PERFORMED'};
    const stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)return {decision:'STOP',reason:'INVALID_FILE',execution:'NOT_PERFORMED'};
    const evidence=JSON.parse(await fs.readFile(file,'utf8'));
    const result=assessRecovery(evidence);
    return {...result,execution:'NOT_PERFORMED'};
  }catch{return {decision:'STOP',reason:'READ_OR_PARSE_ERROR',execution:'NOT_PERFORMED'};}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=process.argv.length===3?await evaluateSnapshot(process.argv[2]):{decision:'STOP',reason:'USAGE',execution:'NOT_PERFORMED'};
  console.log(JSON.stringify(result));
  if(result.decision==='STOP')process.exitCode=1;
}
