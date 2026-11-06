import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url));
const taskId = 'nx-codex-recovery-20261106';
function start(dir) {
  const child = spawn(process.execPath, [worker, dir], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; });
  child.stderr.on('data', b => { stderr += b; });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr })); });
  return { child, done, output: () => stdout };
}
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nx-recovery-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
async function snapshot(dir) {
  return Promise.all((await fs.readdir(dir)).sort().map(async n => [n, (await fs.readFile(path.join(dir, n))).toString('base64')]));
}
test('real crash, durable checkpoint, single effect, recovery and COMPLETE replay rejection', { timeout: 15000 }, async t => {
  const dir = await fixture(t);
  const first = start(dir);
  t.after(() => { if (first.child.exitCode === null && first.child.signalCode === null) first.child.kill('SIGKILL'); });
  const deadline = Date.now() + 5000;
  while (!first.output().includes('WORKER_READY')) {
    if (Date.now() > deadline) assert.fail('ready timeout');
    await new Promise(r => setTimeout(r, 20));
  }
  assert.equal(first.output(), `WORKER_READY pid=${first.child.pid}\n`);
  const cp = JSON.parse(await fs.readFile(path.join(dir, 'checkpoint.json'), 'utf8'));
  assert.equal(cp.taskId, taskId); assert.equal(cp.pid, first.child.pid);
  assert.equal(cp.stage, 'waiting_for_crash'); assert.ok(Number.isFinite(Date.parse(cp.timestamp)));
  const before = await snapshot(dir);
  const effectStat = await fs.stat(path.join(dir, 'effect-once.txt'));
  assert.equal(first.child.exitCode, null);
  assert.equal(first.child.kill('SIGKILL'), true);
  const crashed = await first.done;
  assert.notEqual(crashed.code, 0); assert.equal(crashed.stderr, '');
  const recovered = await start(dir).done;
  assert.deepEqual(recovered, { code: 0, signal: null, stdout: 'RECOVERED_COMPLETE\n', stderr: '' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'complete.json'), 'utf8')), { taskId, recovered: true });
  assert.deepEqual((await snapshot(dir)).filter(([n]) => n !== 'complete.json'), before);
  assert.equal((await fs.stat(path.join(dir, 'effect-once.txt'))).mtimeMs, effectStat.mtimeMs);
  const complete = await snapshot(dir);
  assert.equal((await start(dir).done).code, 1);
  assert.deepEqual(await snapshot(dir), complete);
});
test('invalid states fail closed without overwrites or secret output', async t => {
  for (const state of ['partial', 'wrong-task', 'bad-effect', 'bad-json', 'extra']) {
    const dir = await fixture(t);
    await fs.writeFile(path.join(dir, 'checkpoint.json'), state === 'bad-json' ? 'PRIVATE_SENTINEL' : JSON.stringify({ taskId: state === 'wrong-task' ? 'PRIVATE_SENTINEL' : taskId, stage: 'waiting_for_crash', pid: 123, timestamp: new Date().toISOString() }));
    if (state !== 'partial') await fs.writeFile(path.join(dir, 'effect-once.txt'), state === 'bad-effect' ? 'PRIVATE_SENTINEL' : `${taskId}: effect once\n`);
    if (state === 'extra') await fs.writeFile(path.join(dir, 'unexpected'), 'PRIVATE_SENTINEL');
    const before = await snapshot(dir);
    const result = await start(dir).done;
    assert.equal(result.code, 1); assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'FAIL: invalid or unexpected lab state\n');
    assert.deepEqual(await snapshot(dir), before);
  }
});
