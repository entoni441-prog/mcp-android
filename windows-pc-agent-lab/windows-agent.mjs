#!/usr/bin/env node
// Windows PC Agent laboratory — single authorized read-only capability report.
// Requires Node.js 24; no npm packages, admin privileges, listening ports,
// remote shell, background service, persistence, file scanning, or credentials.
import {randomBytes,generateKeyPairSync,createHash,sign} from "node:crypto";
import {spawnSync} from "node:child_process";

const base=process.env.PC_AGENT_ENDPOINT?.trim().replace(/\/$/,"");
if (!base) {console.error("Missing PC_AGENT_ENDPOINT; nothing sent.");process.exit(2);}
let endpoint;
try {
  endpoint=new URL(base);
  if(endpoint.protocol!=="https:" ||
     !endpoint.hostname.endsWith(".workers.dev") ||
     endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
     endpoint.pathname!=="/") throw Error("bad endpoint");
} catch {console.error("Endpoint must be a standalone HTTPS workers.dev origin.");process.exit(2);}
if (process.platform!=="win32") {console.error("This diagnostic runs on Windows only.");process.exit(2);}

const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const id=randomBytes(16).toString("hex");
const {privateKey,publicKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
const sourceJwk=publicKey.export({format:"jwk"});
const jwk={kty:"EC",crv:"P-256",x:sourceJwk.x,y:sourceJwk.y};
const fingerprint=createHash("sha256").update(JSON.stringify(jwk)).digest("hex").slice(0,16);
const digest = value=>createHash("sha256").update(value).digest("hex");

async function request(path,method="GET",data=null) {
  const options={method,headers:{accept:"application/json"} ,signal:AbortSignal.timeout(9000)};
  if (data!==null) {
    options.headers["content-type"]="application/json";
    options.body=JSON.stringify(data);
  }
  const response=await fetch(new URL(path,base),options);
  const raw=await response.text();
  if(raw.length>2000) throw Error("Oversized response");
  let object;
  try {object=JSON.parse(raw);} catch {throw Error("Invalid server JSON");}
  return {http:response.status,...object};
}

function systemSnapshot() {
  // Fixed allowlist of WMI read commands; NEVER accept commands from the network.
  const ps = [
    "$ErrorActionPreference='Stop'",
    "$c=Get-CimInstance Win32_ComputerSystem",
    "$p=Get-CimInstance Win32_Processor | Select-Object -First 1",
    "$o=Get-CimInstance Win32_OperatingSystem",
    "$dr=@(Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | ForEach-Object { [ordered]@{drive=[string]$_.DeviceID;freeGb=[math]::Round($_.FreeSpace/1GB,1);sizeGb=[math]::Round($_.Size/1GB,1)} })",
    "$v=[ordered]@{monitor=[bool]$p.VMMonitorModeExtensions;firmware=[bool]$p.VirtualizationFirmwareEnabled;slat=[bool]$p.SecondLevelAddressTranslationExtensions}",
    "$x=[ordered]@{windows=[string]$o.Caption;processor=[string]$p.Name;cpuCores=[int]$p.NumberOfCores;ramGb=[math]::Round($c.TotalPhysicalMemory/1GB,1);virtualization=$v;disks=$dr}",
    "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)",
    "ConvertTo-Json -InputObject $x -Depth 4 -Compress",
  ].join("; ");
  const proc=spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",ps],
                       {encoding:"utf8",timeout:25000,maxBuffer:65536,windowsHide:true});
  if(proc.error || proc.status!==0) throw Error("Local read-only WMI diagnostics failed.");
  let data;
  try {data=JSON.parse(proc.stdout.trim());}
  catch {throw Error("Unable to parse local Windows diagnostics.");}
  const diskList=Array.isArray(data.disks)?data.disks:(data.disks?[data.disks]:[]);
  const report={
    kind:"windows-readonly-v1",
    windows:data.windows,
    processor:data.processor,
    cpuCores:Number(data.cpuCores),
    ramGb:Number(data.ramGb),
    virtualization:data.virtualization,
    disks:diskList,
    nodeVersion:process.version,
  };
  if(!report.windows || !report.processor || !Number.isFinite(report.ramGb))
    throw Error("Incomplete WMI diagnostics.");
  return report;
}

async function main() {
  console.log("PC Agent — защищённая первичная диагностика (только чтение)");
  console.log("Отпечаток устройства:", fingerprint);
  console.log("До одобрения отчёт с компьютера НЕ отправляется.");
  const enrollment=await request("/v1/enroll","POST",{id,publicKey:jwk});
  if(enrollment.http!==202 || enrollment.fingerprint!==fingerprint)
    throw Error("Registration rejected: "+(enrollment.error||enrollment.status||enrollment.http));
  console.log("Заявка создана. Сообщи в ChatGPT только: «агент запущен».");
  console.log("Ожидание одобрения до 12 минут. Прервать: Ctrl+C.");
  let approved=false;
  for(let attempt=0;attempt<72;attempt++) {
    const state=await request("/v1/status?id="+id);
    if(state.status==="approved"){approved=true;break;}
    if(state.status==="expired" || state.status==="rejected")
      throw Error("Pairing expired or rejected.");
    await sleep(10000);
  }
  if(!approved) throw Error("Pairing not approved in time.");
  console.log("Устройство одобрено. Считываю только фиксированные характеристики Windows...");
  const report=systemSnapshot();
  const timestamp=Math.floor(Date.now()/1000),nonce=randomBytes(16).toString("hex");
  const canonical=[id,timestamp,nonce,digest(JSON.stringify(report))].join("\n");
  const signature=sign("sha256",Buffer.from(canonical),{key:privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url");
  const response=await request("/v1/report","POST",{id,timestamp,nonce,signature,report});
  if(response.http!==201 || response.status!=="accepted")
    throw Error("Server did not accept report: "+(response.error||response.http));
  console.log("ГОТОВО: диагностический отчёт принят. Пароли, файлы и токены не передавались.");
  console.log("Теперь ChatGPT сможет прочитать отчёт через защищённый Cloudflare API.");
}
main().catch(error=>{console.error("STOP:",error.message);process.exitCode=1;});
