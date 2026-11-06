import { promises as fs } from 'node:fs';
import path from 'node:path';

export const taskId = 'nx-codex-recovery-20261106';
export const effect = 'nx-codex-recovery-20261106: effect once\n';

async function main() {
  const dir = process.argv[2];
  if (!dir || !path.isAbsolute(dir)) throw Error();
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error();
  const names = await fs.readdir(dir);
  if (names.length === 0) {
    const cp = { taskId, stage: 'waiting_for_crash', pid: process.pid, timestamp: new Date().toISOString() };
    const temp = path.join(dir, 'checkpoint.tmp');
    const handle = await fs.open(temp, 'wx');
    try { await handle.writeFile(JSON.stringify(cp) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    // Exclusive publication: never replace a checkpoint that appeared concurrently.
    await fs.link(temp, path.join(dir, 'checkpoint.json'));
    await fs.unlink(temp);
    const out = await fs.open(path.join(dir, 'effect-once.txt'), 'wx');
    try { await out.writeFile(effect); await out.sync(); }
    finally { await out.close(); }
    console.log(`WORKER_READY pid=${process.pid}`);
    await new Promise(resolve => setTimeout(resolve, 90_000));
    throw Error(); // Missing external crash is a failed experiment, never completion.
  }
  if (names.length !== 2 || !names.includes('checkpoint.json') || !names.includes('effect-once.txt')) throw Error();
  for (const name of names) {
    const s = await fs.lstat(path.join(dir, name));
    if (!s.isFile() || s.isSymbolicLink() || s.size > 4096) throw Error();
  }
  const cp = JSON.parse(await fs.readFile(path.join(dir, 'checkpoint.json'), 'utf8'));
  if (Object.keys(cp).sort().join(',') !== 'pid,stage,taskId,timestamp' || cp.taskId !== taskId || cp.stage !== 'waiting_for_crash' || !Number.isSafeInteger(cp.pid) || cp.pid <= 0 || typeof cp.timestamp !== 'string' || !Number.isFinite(Date.parse(cp.timestamp))) throw Error();
  if (await fs.readFile(path.join(dir, 'effect-once.txt'), 'utf8') !== effect) throw Error();
  const complete = await fs.open(path.join(dir, 'complete.json'), 'wx');
  try { await complete.writeFile(JSON.stringify({ taskId, recovered: true }) + '\n'); await complete.sync(); }
  finally { await complete.close(); }
  console.log('RECOVERED_COMPLETE');
}

main().catch(() => { console.error('FAIL: invalid or unexpected lab state'); process.exitCode = 1; });
