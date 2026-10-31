#!/usr/bin/env node
// Deterministic dependency-free bundle of existing v1 and isolated v2 handlers.
// Does not deploy anything; never rewrite live v1 module or main branch.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
function wrap(filename,name){
  const input=readFileSync(path.join(root,filename),'utf8');
  const marker='export default {';
  if(input.split(marker).length!==2)throw Error('Unexpected default export in '+filename);
  return `const ${name}=(()=>{\n${input.replace(marker,'return {')}\n})();\n`;
}
const v1=wrap('../worker.mjs','v1');
const v2=wrap('worker-v2.mjs','v2');
const dispatch=`export default {\n  fetch(request,env,ctx) {\n    const route=new URL(request.url).pathname;\n    if(route==='/v2/enroll'||route==='/v2/status'||route==='/v2/heartbeat'||route.startsWith('/v2/')) return v2.fetch(request,env,ctx);\n    return v1.fetch(request,env,ctx);\n  }\n};\n`;
const output='/* generated offline: v1 + v2, no external deps */\n'+v1+'\n'+v2+'\n'+dispatch;
mkdirSync(path.join(root,'.dist'),{recursive:true});
writeFileSync(path.join(root,'.dist','worker-combined.mjs'),output);
console.log('Combined worker generated locally; no deployment.');
