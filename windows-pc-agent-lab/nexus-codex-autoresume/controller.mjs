import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

const exec = promisify(execFile);
const git = (args, cwd) => exec('git',args,{cwd,timeout:10000,maxBuffer:1024*1024,windowsHide:true});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const inside = (a, b) => { const r = path.relative(a, b); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
const exists = async p => { try { await fs.stat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const hash = async p => crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex');
const fail = code => { throw new Error(code); };
const required = ['taskId','approved','workingDirectory','codexExe','codexSha256','expectedBranch','stateDirectory','initialPrompt','resumePrompt','maxResumes','completionFile'];
export async function validate(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).some(k => !required.includes(k)) || required.some(k => !(k in m))) fail('MANIFEST_SCHEMA');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(m.taskId) || typeof m.taskId !== 'string' || m.approved !== true || m.maxResumes !== 1) fail('MANIFEST_SCHEMA');
  for (const k of ['workingDirectory','codexExe','stateDirectory','completionFile']) if (typeof m[k] !== 'string' || !path.isAbsolute(m[k]) || path.normalize(m[k]) !== m[k]) fail('MANIFEST_PATH');
  for (const k of ['initialPrompt','resumePrompt','expectedBranch']) if (typeof m[k] !== 'string' || !m[k].trim() || m[k].length > 32768 || m[k].includes('\0')) fail('MANIFEST_SCHEMA');
  if (typeof m.codexSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(m.codexSha256)) fail('MANIFEST_SCHEMA');
  const work = await fs.realpath(m.workingDirectory);
  const repo = await fs.realpath((await git(['rev-parse','--show-toplevel'],work)).stdout.trim());
  if (work !== repo) fail('MANIFEST_PATH');
  // Require a pre-existing state directory so realpath resolves every ancestor.
  const state = await fs.realpath(m.stateDirectory);
  const completionParent = await fs.realpath(path.dirname(m.completionFile));
  if (inside(repo,state) || inside(state,repo) || !inside(state,completionParent) || m.completionFile === state || ['state.json','owner.json'].includes(path.basename(m.completionFile).toLowerCase())) fail('PATH_OVERLAP');
  if (await exists(m.completionFile)) { const s = await fs.lstat(m.completionFile); if (s.isSymbolicLink() || !s.isFile()) fail('MANIFEST_PATH'); }
  return m;
}

async function atomic(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const h = await fs.open(temp, 'wx', 0o600);
  try { await h.writeFile(JSON.stringify(value)); await h.sync(); } finally { await h.close(); }
  await fs.rename(temp,file);
  try { const d = await fs.open(path.dirname(file),'r'); try { await d.sync(); } finally { await d.close(); } } catch { /* Directory fsync unavailable on Windows. */ }
}

export async function runManifest(input, options = {}) {
  let state, stateFile, activeChild;
  let writes = Promise.resolve();
  const save = async (status, reason) => { state.status = status; state.reason = reason; state.updatedAt = new Date().toISOString(); const snapshot = {...state}; writes = writes.then(() => atomic(stateFile,snapshot)); await writes; return { taskId: snapshot.taskId, status, reason, attempt: snapshot.attempt, childPid: snapshot.childPid, threadId: snapshot.threadId }; };
  try {
    const m = await validate(input);
    const stopDir = options.ownerDirectory ?? path.join(os.homedir(),'.nexus-host');
    const stopped = async () => (await exists(path.join(stopDir,'owner-stop.json'))) || (await exists(path.join(stopDir,'host-off')));
    const guard = async () => {
      if (await stopped()) fail('OWNER_STOP');
      if (await hash(m.codexExe) !== m.codexSha256) fail('CLI_HASH');
      if ((await git(['branch','--show-current'],m.workingDirectory)).stdout.trim() !== m.expectedBranch) fail('WRONG_BRANCH');
      const lines = (await git(['status','--porcelain','--untracked-files=all'],m.workingDirectory)).stdout.split(/\r?\n/).filter(Boolean);
      if (lines.some(l => !/^\?\? windows-pc-agent-lab\/nexus-codex-autoresume\//.test(l))) fail('DIRTY_WORKTREE');
    };
    stateFile = path.join(m.stateDirectory,'state.json');
    // Permanent exclusive claim: even a supervisor crash must never silently rerun a task.
    const claim = await fs.open(path.join(m.stateDirectory,'owner.json'),'wx',0o600).catch(() => fail('ALREADY_CLAIMED'));
    try { await claim.writeFile(JSON.stringify({taskId:m.taskId})); await claim.sync(); } finally { await claim.close(); }
    state = { taskId:m.taskId, attempt:0, childPid:null, threadId:null, recordedStatus:null, createdAt:new Date().toISOString() };
    await save('CREATED','CREATED');
    const completed = async () => {
      try {
        const stat = await fs.lstat(m.completionFile);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) return false;
        const marker = JSON.parse(await fs.readFile(m.completionFile,'utf8'));
        return marker.taskId === m.taskId && marker.status === 'completed';
      } catch { return false; }
    };
    for (;;) {
      await guard();
      if (await completed()) return await save('COMPLETED','COMPLETION_MARKER');
      const args = state.attempt === 0
        ? ['exec','--json','--sandbox','workspace-write','-C',m.workingDirectory,m.initialPrompt]
        : ['exec','resume','--json',state.threadId,m.resumePrompt];
      if (await stopped()) return await save('STOP','OWNER_STOP');
      state.recordedStatus = null;
      const child = spawn(m.codexExe,[...(options.testScript ? [options.testScript] : []),...args], { cwd:m.workingDirectory, stdio:['ignore','pipe','pipe'], windowsHide:true });
      activeChild = child;
      // Install listeners immediately, before durable writes or asynchronous guards.
      let buffer = '', bad = false, timedOut = false, ownerStop = false;
      const decoder = new StringDecoder('utf8');
      const death = new Promise(resolve => { child.once('error',() => resolve({error:true})); child.once('close',(code,signal) => resolve({code,signal})); });
      child.stderr.on('data',() => {});
      child.stdout.on('data', chunk => {
        buffer += decoder.write(chunk);
        if (buffer.length > 65536) { bad = true; buffer = ''; return; }
        let n;
        while ((n = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0,n); buffer = buffer.slice(n+1);
          try {
            const e = JSON.parse(line);
            if (e.type === 'thread.started') {
              if (typeof e.thread_id !== 'string' || !uuid.test(e.thread_id) || (state.threadId && state.threadId !== e.thread_id)) bad = true;
              else { state.threadId = e.thread_id; void save(state.attempt ? 'RECOVERING':'RUNNING','THREAD_RECORDED').catch(() => { bad = true; }); }
            } else if (['turn.completed','turn.failed'].includes(e.type)) state.recordedStatus = e.type;
          } catch { bad = true; }
        }
      });
      state.childPid = child.pid ?? null;
      await save(state.attempt ? 'RECOVERING':'RUNNING','CHILD_STARTED');
      let interval;
      const boundary = new Promise(resolve => {
        const start = Date.now();
        interval = setInterval(async () => {
          try {
            ownerStop = await stopped();
            timedOut = Date.now()-start >= (options.timeoutMs ?? 300000);
            if (ownerStop || timedOut) resolve(null);
          } catch { ownerStop = true; resolve(null); }
        },50);
      });
      const result = await Promise.race([death,boundary]);
      clearInterval(interval);
      if (!result) {
        // Signal only our own ChildProcess handle; never target a discovered PID or owner app.
        try { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); } catch { /* Fail closed. */ }
        const ended = await Promise.race([death.then(() => true),new Promise(resolve => setTimeout(() => resolve(false),1500))]);
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
        return await save('STOP',ownerStop ? (ended ? 'OWNER_STOP_CHILD_TERMINATED' : 'OWNER_STOP_CHILD_MAY_BE_ALIVE') : (ended ? 'TIMEOUT_CHILD_TERMINATED' : 'TIMEOUT_CHILD_MAY_BE_ALIVE'));
      }
      activeChild = null;
      buffer += decoder.end();
      if (await stopped()) return await save('STOP','OWNER_STOP');
      if (await completed()) return await save('COMPLETED','COMPLETION_MARKER');
      if (buffer.trim() || bad) return await save('STOP','BAD_EVENTS');
      if (result.error) return await save('STOP','SPAWN_FAILED');
      if (state.recordedStatus === 'turn.failed') return await save('STOP','TURN_FAILED');
      if (state.recordedStatus === 'turn.completed') return await save('STOP','COMPLETION_UNCONFIRMED');
      if (result.code === 0) return await save('STOP','COMPLETION_UNCONFIRMED');
      if (!state.threadId) return await save('STOP','MISSING_THREAD');
      if (state.attempt >= m.maxResumes) return await save('STOP','RESUMES_EXHAUSTED');
      // close proves this exact spawned child exited; nonzero exit/signal is the crash boundary.
      state.attempt++;
      await save('RECOVERING','VERIFIED_CHILD_EXIT');
    }
  } catch (e) {
    if (activeChild) { activeChild.stdout.destroy(); activeChild.stderr.destroy(); activeChild.unref(); }
    const reason = ['MANIFEST_SCHEMA','MANIFEST_PATH','PATH_OVERLAP','ALREADY_CLAIMED','OWNER_STOP','CLI_HASH','WRONG_BRANCH','DIRTY_WORKTREE'].includes(e.message) ? e.message : 'IO_ERROR';
    if (state) return await save('STOP',reason);
    return {status:'STOP',reason};
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try {
    if (process.argv.length !== 4 || process.argv[2] !== 'run') fail('USAGE');
    result = await runManifest(JSON.parse(await fs.readFile(process.argv[3],'utf8')));
  } catch { result = {status:'STOP',reason:'INVALID_INPUT'}; }
  console.log(JSON.stringify(result));
  if (result.status !== 'COMPLETED') process.exitCode = 1;
}
