// Isolated test-only worker. Consumes a durable budget claim and remains alive
// until its test owner SIGKILLs it. NO network calls or other external effects.
import path from 'node:path';
import {claimRecoveryAttempt} from './recovery-budget.mjs';
const [dir,task,epoch]=process.argv.slice(2);
if(process.argv.length!==5||!path.isAbsolute(dir)||!Number.isSafeInteger(Number(epoch)))process.exit(64);
const claim=await claimRecoveryAttempt(dir,task,Number(epoch));
process.stdout.write(JSON.stringify(claim)+'\n');
if(claim.decision!=='CLAIMED')process.exit(19);
setInterval(()=>{},500);
