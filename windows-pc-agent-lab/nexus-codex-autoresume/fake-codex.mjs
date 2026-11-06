import fs from 'node:fs/promises';
import path from 'node:path';
export const THREAD_ID = '019a8f9b-1452-71c0-8a17-6915a0904d67';

// A test-only script, launched as: node fake-codex.mjs exec [...].
const args = process.argv.slice(2);
if (args[0] !== 'exec' || !args.includes('--json')) process.exit(2);
const resume = args[1] === 'resume';
const config = JSON.parse(await fs.readFile(path.join(process.cwd(),'mock.json'),'utf8'));
const { stateDirectory: dir, taskId, mode } = config;
const marker = async () => fs.writeFile(path.join(dir,'complete.json'),JSON.stringify({taskId,status:'completed'}));
if (resume) {
  if (args[3] !== THREAD_ID) process.exit(3);
  await fs.writeFile(path.join(dir,'resumed.json'),JSON.stringify({threadId:args[3],pid:process.pid}));
  if (mode === 'exhaust') process.exit(4);
  await marker();
  console.log(JSON.stringify({type:'turn.completed'}));
} else {
  if (mode === 'bad') { console.log('invalid JSON CANARY_SECRET'); process.exit(5); }
  if (!['missing','slow-missing'].includes(mode)) {
    const event = JSON.stringify({type:'thread.started',thread_id:THREAD_ID,secret:'CANARY_SECRET'});
    // Deliberately split one event across multiple writes.
    process.stdout.write(event.slice(0,17));
    await new Promise(r => setTimeout(r,20));
    process.stdout.write(event.slice(17)+'\n');
  }
  await fs.writeFile(path.join(dir,'effect-once.txt'),'effect\n',{flag:'wx'});
  await fs.writeFile(path.join(dir,'checkpoint.json'),JSON.stringify({pid:process.pid,threadId:mode === 'missing' ? null:THREAD_ID}));
  console.log(JSON.stringify({type:'mock.ready',pid:process.pid,text:'CANARY_SECRET'}));
  if (mode === 'success' || mode === 'ambiguous') {
    await marker();
    process.exit(mode === 'success' ? 0:6);
  }
  if (mode === 'turn-failed' || mode === 'turn-completed') {
    console.log(JSON.stringify({type:mode === 'turn-failed' ? 'turn.failed':'turn.completed'}));
    process.exit(8);
  }
  if (mode === 'missing' || mode === 'exhaust') process.exit(7);
  if (mode === 'slow-exit' || mode === 'slow-missing' || mode === 'slow-orphan') { await new Promise(r=>setTimeout(r,mode === 'slow-orphan' ? 6000 : 2200)); process.exit(9); }
  setInterval(() => {},1000);
}
