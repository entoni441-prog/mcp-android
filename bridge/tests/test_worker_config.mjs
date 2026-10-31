#!/usr/bin/env node
// Hermetic Worker config authorization tests. No network, secrets or Cloudflare account needed.
// Usage: node bridge/tests/test_worker_config.mjs
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
const here=dirname(fileURLToPath(import.meta.url));
const src=readFileSync(resolve(here,"../worker.js"),"utf8");
const preamble=src.split("export default {")[0].replace("const enc = new TextEncoder();","");
const {validConfigJob,sanitizedResult}=new Function(preamble+" return {validConfigJob,sanitizedResult};")();
const now=Math.floor(Date.now()/1000);
const good={kind:"config.apply",setting_key:"verbosity",setting_value:"low",expected_sha256:"a".repeat(64),approved:1,expires_at:now+600};
const tests=[
  ["approved",()=>assert.equal(validConfigJob(good),true)],
  ["unapproved",()=>assert.equal(validConfigJob({...good,approved:0}),false)],
  ["expired",()=>assert.equal(validConfigJob({...good,expires_at:now-10}),false)],
  ["no privilege settings",()=>assert.equal(validConfigJob({...good,setting_key:"agentMode"}),false)],
  ["no arbitrary values",()=>assert.equal(validConfigJob({...good,setting_value:"sudo"}),false)],
  ["invalid digest",()=>assert.equal(validConfigJob({...good,expected_sha256:"invalid"}),false)],
  ["rollback allowed",()=>assert.equal(validConfigJob({...good,kind:"config.rollback",setting_value:null}),true)],
  ["rollback unknown key",()=>assert.equal(validConfigJob({...good,kind:"config.rollback",setting_key:"permissions"}),false)],
  ["plan no approval needed",()=>assert.equal(validConfigJob({...good,kind:"config.plan",approved:0}),true)],
  ["valid apply reply",()=>assert.ok(sanitizedResult(good,{status:"updated",key:"verbosity",to:"low",sha256:"b".repeat(64),before_sha256:"a".repeat(64),rollback_available:true}))],
  ["forged key rejected",()=>assert.equal(sanitizedResult(good,{status:"updated",key:"agentMode",to:"low",sha256:"b".repeat(64),before_sha256:"a".repeat(64),rollback_available:true}),null)],
  ["wrong previous digest",()=>assert.equal(sanitizedResult(good,{status:"updated",key:"verbosity",to:"low",sha256:"b".repeat(64),before_sha256:"c".repeat(64),rollback_available:true}),null)],
  ["extra secrets redacted",()=>assert.equal(Object.hasOwn(sanitizedResult(good,{status:"unchanged",key:"verbosity",value:"low",sha256:"a".repeat(64),credential:"SECRET"}),"credential"),false)],
  ["malformed inspect redacted",()=>assert.equal(sanitizedResult({kind:"config.inspect"},{status:"ok",sha256:"a".repeat(64),preferences:{verbosity:"TOKEN",colorScheme:null,altScreenMode:null,runningLightSpeed:null}}),null)]
];
for (const [name,fn] of tests){fn();process.stdout.write("PASS "+name+"\n");}
console.log(tests.length+" tests passed.");
