/**
 * Durable idempotency ledger, intended ONLY for a directory provisioned by
 * an administrator with ACL preventing owner/chat/Host write, rename, delete.
 * The broker itself must run elevated. Mode 0600 alone is NOT a Windows ACL.
 */
import fs from 'node:fs';
import path from 'node:path';

const ID=/^[a-f0-9]{32}$/;
const STATES=new Set(['executing','installed_verified','installed_not_verified',
  'install_result_unverified','outcome_unknown']);
export function createProtectedJournal(dir,{fsImpl=fs}={}){
  if(typeof dir!=='string'||!path.win32.isAbsolute(dir))throw Error('invalid_journal_dir');
  const file=id=>{
    if(typeof id!=='string'||!ID.test(id))throw Error('invalid_request_id');
    return path.win32.join(dir,id+'.json');
  };
  // Caller must separately verify the directory ACL; no mkdir here because
  // an untrusted caller must never choose or create its own journal directory.
  return Object.freeze({
    claim(id,receipt){
      const p=file(id);
      if(receipt?.requestId!==id)throw Error('receipt_request_mismatch');
      const data=JSON.stringify({version:1,state:'claimed',receipt});
      try{fsImpl.writeFileSync(p,data,{flag:'wx',mode:0o600});return true;}
      catch(e){if(e?.code==='EEXIST')return false;throw e;}
    },
    mark(id,state,details={}){
      if(!STATES.has(state))throw Error('invalid_journal_state');
      const p=file(id);
      const prior=JSON.parse(fsImpl.readFileSync(p,'utf8'));
      if(prior?.receipt?.requestId!==id||prior.state==='installed_verified')
        throw Error('journal_corrupt_or_complete');
      // No unsafe reinstall after ambiguity, even if an install later failed:
      // only manual inspection or a NEW separately approved request can follow.
      const safe={version:1,state,receipt:prior.receipt,
        ...(state==='install_result_unverified'?{exitCode:Number.isInteger(details.exitCode)?details.exitCode:null}:{})};
      const temp=p+'.tmp-'+process.pid+'-'+Date.now();
      fsImpl.writeFileSync(temp,JSON.stringify(safe),{flag:'wx',mode:0o600});
      try{fsImpl.renameSync(temp,p);}catch(e){try{fsImpl.unlinkSync(temp);}catch{}throw e;}
    },
    inspect(id){try{return JSON.parse(fsImpl.readFileSync(file(id),'utf8'));}catch(e){if(e?.code==='ENOENT')return null;throw e;}}
  });
}
export function createMemoryJournal(){
  const records=new Map();
  return {
    claim(id,receipt){if(records.has(id))return false;records.set(id,{state:'claimed',receipt});return true;},
    mark(id,state,extra={}){const r=records.get(id);if(!r)throw Error('unclaimed');records.set(id,{...r,state,...extra});},
    inspect(id){return records.get(id)??null;}
  };
}
