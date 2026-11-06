// Test-only detached child. Its survival after a Job Object owner crash would
// be a failure; it must never interact with anything outside its Temp folder.
import fs from 'node:fs/promises';
import path from 'node:path';

const state=process.argv[2];
if(!state||!path.isAbsolute(state))process.exit(2);
await fs.writeFile(path.join(state,'grandchild-ready.json'),JSON.stringify({pid:process.pid,ready:true}));
setInterval(()=>{},2000);
