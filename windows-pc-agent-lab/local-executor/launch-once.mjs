#!/usr/bin/env node
/** User-visible, one-shot local Windows application launcher.
 * This component is NOT a remote agent. No network, job polling, background
 * service, task scheduling, arbitrary commands, shell, or persistence.
 * It reuses the allowlisted open_app operation already tested in actions.mjs.
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {executeJob} from '../v3/actions.mjs';

const allowed = new Set(['notepad','calculator']);

export function parseLocalCommand(argv) {
  if(!Array.isArray(argv)||argv.length!==2||!argv.includes('--approve-once'))
    throw Error('explicit_local_approval_required');
  const selections=argv.filter(x=>x.startsWith('--app='));
  if(selections.length!==1||!allowed.has(selections[0].slice(6)))
    throw Error('invalid_local_app');
  return selections[0].slice(6);
}

function safeLocalPath(s) {
  return typeof s==='string'&&/^[a-zA-Z]:\\/.test(s)&&
    path.win32.isAbsolute(s)&&
    !s.split(/[\\/]/).includes('..')&&!s.includes('\\\\');
}

/** Separate the CLI contract from execution so CI never needs a real desktop. */
export async function launchOnce({
  argv,
  platform=process.platform,
  env=process.env,
  executor=executeJob
}={}) {
  const app=parseLocalCommand(argv);
  if(platform!=='win32')throw Error('windows_only');
  if(!safeLocalPath(env?.LOCALAPPDATA)||!safeLocalPath(env?.SystemRoot))
    throw Error('invalid_windows_environment');
  const workspace=path.win32.join(env.LOCALAPPDATA,'PcAgentReadonlyLab','workspace');
  const result=await executor('open_app',{app},{
    platform:'win32',systemRoot:env.SystemRoot,workspace
  });
  if(!result||result.started!==true||result.app!==app)
    throw Error('app_launch_unconfirmed');
  return {status:'spawn_confirmed',app,mode:'local_foreground_one_shot'};
}

function isDirectExecution() {
  return Boolean(process.argv[1]) &&
    path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
}
if(isDirectExecution()) {
  launchOnce({argv:process.argv.slice(2)})
    .then(result=>process.stdout.write(JSON.stringify(result)+'\n'))
    .catch(e=>{
      const reasons=new Set([
        'explicit_local_approval_required','invalid_local_app',
        'windows_only','invalid_windows_environment',
        'invalid_windows_system_root','app_launch_failed',
        'app_launch_unconfirmed'
      ]);
      const reason=reasons.has(e.message)?e.message:'local_launch_failed';
      process.stdout.write(JSON.stringify({status:'blocked',reason})+'\n');
      process.exitCode=2;
    });
}
