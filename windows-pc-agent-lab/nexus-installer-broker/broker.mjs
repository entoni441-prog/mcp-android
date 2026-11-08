/**
 * Constrained elevated executor. NO arbitrary command arguments, paths,
 * installer switches, script execution or operating-system security changes.
 * All injected IO must live inside an already provisioned trusted OS boundary.
 */
import path from 'node:path';
import {ALLOWED_INSTALLS,verifyApproval} from './contract.mjs';

const SHA=/^[a-f0-9]{64}$/;
const SECURE_STAGE='C:\\ProgramData\\NEXUS\\InstallerBroker\\staging';
const MSIEXE='C:\\Windows\\System32\\msiexec.exe';
const same=(x,y)=>typeof x==='string'&&x.toLowerCase()===y.toLowerCase();
const isSafeStaged=(p,sha)=>typeof p==='string'&&
  same(path.win32.normalize(p),path.win32.join(SECURE_STAGE,sha+'.msi'));
function verifiedArtifact(meta,pkg){
  return !!meta&&meta.kind==='msi'&&meta.sha256===pkg.sha256&&
    meta.bytes===pkg.bytes&&meta.signatureValid===true&&
    meta.publisher===pkg.publisher;
}
export function fixedInstallCommand(stagedPath,sha256){
  if(!SHA.test(sha256)||!isSafeStaged(stagedPath,sha256))
    throw Error('untrusted_staged_path');
  return Object.freeze({exe:MSIEXE,args:Object.freeze(['/i',stagedPath,'/qn','/norestart'])});
}
export function createInstallerBroker({keys,now=()=>Date.now(),journal,io,audit=()=>{},
    privilegedReady=()=>false,stopRequested=()=>false}={}){
  if(!journal||typeof journal.claim!=='function'||typeof journal.mark!=='function')
    throw Error('missing_protected_journal');
  if(!io||!['readVerifiedSource','copyToProtectedStage','readVerifiedStage',
      'runFixedInstaller','verifyInstalled'].every(k=>typeof io[k]==='function'))
    throw Error('missing_verified_io');
  return {
    /**
     * Caller is always the privileged broker's trusted IPC handler, never
     * the untrusted ChatGPT model. Only authentic signed approvals are accepted.
     * No automatic retries after the first attempt / ambiguous outcomes.
     */
    async install(envelope){
      if(!privilegedReady())throw Error('broker_not_privileged_or_provisioned');
      if(stopRequested())throw Error('broker_stopped');
      const grant=verifyApproval(envelope,{publicKeys:keys,now:now()});
      const pkg=ALLOWED_INSTALLS[grant.packageId];
      if(!pkg)throw Error('package_not_allowlisted');
      const src=await io.readVerifiedSource(grant.packageId,pkg);
      if(!verifiedArtifact(src,pkg))throw Error('untrusted_source_package');
      if(stopRequested())throw Error('broker_stopped');

      // Must COPY under an Admin/SYSTEM-owned protected directory with ACL
      // checked independently by the OS-owned provisioner.
      const staged=await io.copyToProtectedStage(src,pkg,SECURE_STAGE);
      if(!isSafeStaged(staged?.path,pkg.sha256))
        throw Error('untrusted_stage_location');
      const checked=await io.readVerifiedStage(staged.path,pkg);
      if(!verifiedArtifact(checked,pkg)||!same(checked.path,staged.path))
        throw Error('staged_content_or_signer_changed');
      const command=fixedInstallCommand(staged.path,pkg.sha256);
      if(stopRequested())throw Error('broker_stopped');

      // Durable single-use claim BEFORE the privileged effect. An interrupted
      // or ambiguous operation stays claimed and can never be replayed.
      const receipt={requestId:grant.id,packageId:grant.packageId,
        channel:grant.channel,artifactSha256:grant.sha256,acceptedAt:now()};
      if(!journal.claim(grant.id,receipt))throw Error('approval_replay_refused');
      audit({event:'install_claimed',requestId:grant.id,channel:grant.channel,
        packageId:grant.packageId});
      try{
        // Recheck STOP after durable claim, immediately before MSI execution.
        // Once an MSI transaction starts we never auto-retry or re-enter it.
        if(stopRequested()){
          journal.mark(grant.id,'outcome_unknown');
          return {status:'stopped_before_launch',requestId:grant.id};
        }
        journal.mark(grant.id,'executing');
        const result=await io.runFixedInstaller(command);
        if(result?.exitCode!==0){
          journal.mark(grant.id,'install_result_unverified',{exitCode:Number.isInteger(result?.exitCode)?result.exitCode:null});
          return {status:'install_result_unverified',requestId:grant.id};
        }
        const ok=await io.verifyInstalled(pkg);
        journal.mark(grant.id,ok?'installed_verified':'installed_not_verified');
        return {status:ok?'installed_verified':'installed_not_verified',requestId:grant.id};
      }catch(e){
        journal.mark(grant.id,'outcome_unknown');
        // Deliberately DO NOT log error detail: external installers can echo
        // paths, usernames and secrets. Owner sees only generic outcome.
        return {status:'outcome_unknown',requestId:grant.id};
      }
    }
  };
}
export {SECURE_STAGE,MSIEXE};
