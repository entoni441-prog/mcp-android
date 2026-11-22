import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {spawnSync} from 'node:child_process';
import {createProcs,processIdentity,sameProcessIdentity,lifetimeScript} from './procs.mjs';
import {createConsent} from './consent.mjs';
import {validateCapabilities} from './capabilities.mjs';

const A='638000000000000001',B='638000000000000002';
const child=pid=>Object.assign(new EventEmitter(),{pid,exitCode:null,signalCode:null,killed:false,kill(){throw Error('unexpected child kill');}});
function fixture({blocked=false,withConsent=true}={}){
 const s={id:{pid:80,process:'notepad',startTime:A},calls:[],audit:[],native:{status:'requested',requested:true},present:true};
 const consent=withConsent?createConsent():null;
 const p=createProcs({caps:validateCapabilities({process_control:true,...(blocked?{blockedApps:['notepad']}:{})}),
 cfg:{workspace:'.',auditFile:'unused'},platform:'win32',systemRoot:'C:\\Windows',consent,
 exec:async()=>({code:0,out:s.present?'"Notepad.exe","80","Console","1","10 K"':''}),
 readIdentity:async()=>s.id,actIdentity:async(id,action)=>{s.calls.push({id,action});return s.native;},audit:e=>s.audit.push(e)});
 return {s,p,consent};
}
test('lifetime: ticks are exact strings and same PID/name is insufficient',()=>{
 assert.equal(processIdentity({pid:80,process:'Notepad',startTime:Number(A)}),null);
 assert.equal(sameProcessIdentity({pid:80,process:'Notepad.exe',startTime:A},{pid:80,process:'notepad',startTime:B}),false);
 assert.equal(sameProcessIdentity({pid:80,process:'Notepad.exe',startTime:A},{pid:80,process:'notepad',startTime:A}),true);
});
test('lifetime: do not register a raw PID or an exited child',async()=>{
 const {p,s}=fixture();assert.equal(await p.registerOwned(80,'bare'),false);
 const c=child(80);c.exitCode=0;assert.equal(await p.registerOwned(c,'exited'),false);
 await assert.rejects(p.process_action({pid:80,action:'kill'}),/process_not_allowed/);
 assert.equal(s.calls.length,0);
});
test('lifetime: same identity exact dispatched action; PID reused or missing refuses and forgets',async()=>{
 for(const next of [{pid:80,process:'notepad',startTime:B},null]){
  const {s,p}=fixture();assert.equal(await p.registerOwned(child(80),'spawn'),true);
  assert.equal((await p.list_processes({})).processes[0].ownedByNexus,true);
  assert.equal((await p.process_action({pid:80,action:'kill'})).requested,true);
  assert.deepEqual(s.calls,[{id:{pid:80,process:'notepad',startTime:A},action:'kill'}]);
  s.id=next;await assert.rejects(p.process_action({pid:80,action:'kill'}),/process_identity_changed/);
  assert.equal(s.calls.length,1);assert.equal((await p.list_processes({})).processes[0].ownedByNexus,false);
  assert.ok(s.audit.some(e=>e.event==='process_ownership_forgotten'));
 }
});
test('lifetime: stale list row never reports ownership',async()=>{
 const {p,s}=fixture();await p.registerOwned(child(80),'spawn');s.id={...s.id,startTime:B};
 assert.equal((await p.list_processes({})).processes[0].ownedByNexus,false);
 await assert.rejects(p.process_action({pid:80,action:'kill'}),/process_not_allowed/);
 assert.equal(s.calls.length,0);
});
test('lifetime: child exit during registration never grants ownership',async()=>{
 const {p,s}=fixture();const c=child(80);const registration=p.registerOwned(c,'spawn');
 c.exitCode=0;c.emit('exit',0);assert.equal(await registration,false);
 await assert.rejects(p.process_action({pid:80,action:'kill'}),/process_not_allowed/);assert.equal(s.calls.length,0);
});
test('lifetime: old child exit does not delete newer registration for reused PID',async()=>{
 const {p,s}=fixture();const c=child(80);await p.registerOwned(c,'first');
 s.id={...s.id,startTime:B};await p.list_processes({});
 const c2=child(80);assert.equal(await p.registerOwned(c2,'second'),true);
 c.exitCode=0;c.emit('exit',0);assert.equal((await p.list_processes({})).processes[0].ownedByNexus,true);
});
test('lifetime: owner close approval is bound to lifetime, not just PID',async()=>{
 const {p,s,consent}=fixture();const grant=await p.process_action({pid:80,action:'close'});
 assert.equal(grant.status,'consent_required');
 const record=consent.take(grant.consentId,'close_save',grant.target);
 assert.equal(record.processIdentity.startTime,A);s.id={...s.id,startTime:B};
 await assert.rejects(p.process_action(record.replay.args,{consented:record}),/consent_target_changed/);
 assert.equal(s.calls.length,0);
});
test('lifetime: final guarded action refusal never retries, and revokes ownership',async()=>{
 const {p,s}=fixture();await p.registerOwned(child(80),'spawn');
 s.native={status:'identity_changed',requested:false};
 await assert.rejects(p.process_action({pid:80,action:'kill'}),/process_identity_changed/);
 assert.equal(s.calls.length,1);assert.ok(s.audit.some(e=>e.event==='process_action_refused'));
 await assert.rejects(p.process_action({pid:80,action:'kill'}),/process_not_allowed/);
 assert.equal(s.calls.length,1);
});
test('lifetime: owner ban preserved; missing consent fails closed',async()=>{
 const {p,s}=fixture({blocked:true});await p.registerOwned(child(80),'spawn');
 await assert.rejects(p.process_action({pid:80,action:'kill'}),/process_not_allowed/);assert.equal(s.calls.length,0);
 const f=fixture({withConsent:false});await assert.rejects(f.p.process_action({pid:80,action:'close'}),/process_not_allowed/);assert.equal(f.s.calls.length,0);
});
test('lifetime: native source uses held handle and time check before object action, no PID tree kill',()=>{
 const id={pid:80,process:'notepad',startTime:A};
 const kill=lifetimeScript(80,'kill',id),close=lifetimeScript(80,'close',id),read=lifetimeScript(80);
 for(const src of [kill,close]){
  assert.ok(src.indexOf('$p.Handle')<src.indexOf('$p.StartTime'));assert.ok(src.indexOf('$ticks -ne')<src.indexOf('else {'));
  assert.match(src,/\$p\.Dispose\(\)/);assert.doesNotMatch(src,/taskkill|Stop-Process|Invoke-Expression/);
 }
 assert.match(kill,/\$p\.Kill\(\)/);assert.match(close,/\$p\.CloseMainWindow\(\)/);
 assert.doesNotMatch(read,/\.Kill\(|CloseMainWindow/);
 assert.throws(()=>lifetimeScript(80,'kill',{...id,startTime:'1; invalid'}),/invalid_args/);
});

test('lifetime: native PowerShell sources parse without running any action',{skip:process.platform!=='win32'},()=>{
 const parse="$source=[Console]::In.ReadToEnd(); $tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors); if($errors.Count -gt 0){ $errors | ForEach-Object { $_.Message }; exit 1 }; Write-Output PARSE_OK";
 for(const action of ['read','close','kill']){
  const src=lifetimeScript(80,action,{pid:80,process:'notepad',startTime:A});
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',parse],{input:src,encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(r.error,undefined);assert.equal(r.status,0,String(r.stdout)+' '+String(r.stderr));assert.match(r.stdout,/PARSE_OK/);
 }
});
test('lifetime: cancel and STOP use original synthetic child handle, not a new PID or process tree',async()=>{
 const children=[],calls=[];
 const spawnFn=()=>{
  const c=child(80+children.length);c.kill=function(){calls.push(this);this.killed=true;this.exitCode=0;this.emit('exit',0);return true;};
  children.push(c);setImmediate(()=>c.emit('spawn'));return c;
 };
 const p=createProcs({caps:validateCapabilities({run_task:true,tasks:{probe:{exe:process.execPath,args:[],timeoutSec:90}}}),
  cfg:{workspace:'.',auditFile:'unused'},platform:'win32',systemRoot:'C:\\Windows',spawnFn,
  readIdentity:async pid=>({pid,process:'node',startTime:A}),exec:async()=>{throw Error('unexpected external process action');}});
 const a=await p.run_task({task:'probe'});assert.equal((await p.task_cancel({id:a.id})).state,'cancelled');
 const b=await p.run_task({task:'probe'});const d=await p.cancelSession('synthetic',{startedAt:0});assert.deepEqual(d.cancelled.map(x=>x.id),[b.id]);
 await p.run_task({task:'probe'});p.stopAll();
 assert.deepEqual(calls,children);
});
