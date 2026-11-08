/**
 * UNPRIVILEGED caller bridge. It NEVER installs or elevates a process.
 * It only queues an already signed & verified owner grant and requests the
 * one fixed admin-provisioned Task Scheduler action.
 *
 * A dedicated Host API may call this later; generic model run_command must
 * NOT become an admin execution bridge.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyApproval} from './contract.mjs';
import {BROKER_TASK_NAME} from './task-xml.mjs';

export const INBOX='C:\\ProgramData\\NEXUS\\InstallerBroker\\inbox';
export function createSubmitter({publicKeys,now=()=>Date.now(),inbox=INBOX,
    fsImpl=fs,spawn=spawnSync}={}){
  if(inbox!==INBOX)throw Error('submitter_path_must_be_pinned');
  return Object.freeze({
    submit(envelope){
      if(process.platform!=='win32')throw Error('windows_only');
      // The unprivileged component cannot sign approvals; it only verifies.
      const grant=verifyApproval(envelope,{publicKeys,now:now()});
      const item=JSON.stringify(envelope);
      if(item.length>8192)throw Error('approval_too_large');
      const file=path.win32.join(INBOX,'current.json');
      // Do not overwrite an earlier request or clear it after unknown outcome.
      // Installer task will check the signature again in a separate OS token.
      try{fsImpl.writeFileSync(file,item,{flag:'wx',encoding:'utf8'});}
      catch(e){if(e?.code==='EEXIST')throw Error('existing_request_requires_manual_reconciliation');throw e;}
      const r=spawn('C:\\Windows\\System32\\schtasks.exe',
        ['/Run','/TN',BROKER_TASK_NAME],{windowsHide:true,encoding:'utf8',
          timeout:20000,maxBuffer:4096});
      if(r.error||r.status!==0)return {status:'queued_not_started',requestId:grant.id};
      return {status:'triggered_unverified',requestId:grant.id};
    }
  });
}
