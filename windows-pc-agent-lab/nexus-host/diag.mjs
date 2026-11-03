/**
 * NEXUS NEXT — R0 Windows diagnostics without GUI (FR-03.1, AC-03, TEST-NEXT-08).
 * Every topic is a FIXED PowerShell script inside NEXUS (CIM/WMI/built-in cmdlets, ConvertTo-Json). No argument of the
 * agent ever becomes script text: the only inputs are the topic name and small validated integers/filters applied in
 * Node after the query. Event Log messages are cut and passed through secret redaction; no file contents are read.
 * Each result: {topic, source, collectedAt (ISO, with the PC's UTC offset), data}.
 */
import path from 'node:path';
import {execFile} from 'node:child_process';
import {requireCap} from './capabilities.mjs';
import {redactSecrets} from './policy.mjs';

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (a, allowed) => isObj(a) && Object.keys(a).every(k => allowed.includes(k));
const J = d => `| ConvertTo-Json -Depth ${d} -Compress`;
const SAFE = "$ErrorActionPreference='SilentlyContinue'; $ProgressPreference='SilentlyContinue';";

/** topic → [source label, script]. Scripts are constants — reviewed once, never assembled from input. */
export const TOPICS = Object.freeze({
  os: ['CIM Win32_OperatingSystem + ComputerSystem', `${SAFE} $o=Get-CimInstance Win32_OperatingSystem; $c=Get-CimInstance Win32_ComputerSystem; [pscustomobject]@{caption=$o.Caption;version=$o.Version;build=$o.BuildNumber;arch=$o.OSArchitecture;installDate=$o.InstallDate;lastBoot=$o.LastBootUpTime;uptimeMin=[int]((Get-Date)-$o.LastBootUpTime).TotalMinutes;locale=$o.Locale;manufacturer=$c.Manufacturer;model=$c.Model;domainJoined=$c.PartOfDomain;userSession=($c.UserName -ne $null)} ${J(3)}`],
  hardware: ['CIM Processor/PhysicalMemory/DiskDrive/LogicalDisk + Storage reliability', `${SAFE} [pscustomobject]@{cpu=@(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,LoadPercentage);memoryGB=[math]::Round(((Get-CimInstance Win32_PhysicalMemory | Measure-Object Capacity -Sum).Sum/1GB),1);freeMemoryMB=[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1KB);disks=@(Get-CimInstance Win32_DiskDrive | Select-Object Model,InterfaceType,MediaType,Status,@{n='sizeGB';e={[math]::Round($_.Size/1GB)}});volumes=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,FileSystem,@{n='sizeGB';e={[math]::Round($_.Size/1GB)}},@{n='freeGB';e={[math]::Round($_.FreeSpace/1GB)}});health=@(Get-PhysicalDisk | Select-Object FriendlyName,MediaType,HealthStatus,OperationalStatus);smart=@(Get-PhysicalDisk | Get-StorageReliabilityCounter | Select-Object DeviceId,Temperature,Wear,ReadErrorsTotal,WriteErrorsTotal,PowerOnHours)} ${J(4)}`],
  processes: ['CIM Win32_Process (tree: pid/parent, no command lines)', `${SAFE} Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,SessionId,@{n='memMB';e={[int]($_.WorkingSetSize/1MB)}},@{n='started';e={$_.CreationDate}} ${J(2)}`],
  services: ['CIM Win32_Service', `${SAFE} Get-CimInstance Win32_Service | Select-Object Name,DisplayName,State,StartMode,StartName ${J(2)}`],
  scheduled_tasks: ['ScheduledTasks module (no task actions/arguments)', `${SAFE} Get-ScheduledTask | ForEach-Object { $i = $_ | Get-ScheduledTaskInfo; [pscustomobject]@{path=$_.TaskPath;name=$_.TaskName;state=[string]$_.State;author=$_.Author;triggers=@($_.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace 'MSFT_Task','' -replace 'Trigger','' });runAs=$_.Principal.UserId;runLevel=[string]$_.Principal.RunLevel;lastRun=$i.LastRunTime;lastResult=$i.LastTaskResult;nextRun=$i.NextRunTime} } ${J(3)}`],
  startup: ['CIM Win32_StartupCommand + Run keys (names only)', `${SAFE} [pscustomobject]@{items=@(Get-CimInstance Win32_StartupCommand | Select-Object Name,Location,User);runKeys=@(foreach($k in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'){ $p=Get-ItemProperty $k; if($p){ $p.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { [pscustomobject]@{key=$k;name=$_.Name} } } })} ${J(3)}`],
  events: ['Get-WinEvent System+Application, level ≤3, last 24 h (messages cut)', `${SAFE} Get-WinEvent -FilterHashtable @{LogName='System','Application';Level=1,2,3;StartTime=(Get-Date).AddHours(-24)} -MaxEvents 60 | Select-Object TimeCreated,LogName,ProviderName,Id,LevelDisplayName,@{n='message';e={ if($_.Message){ $_.Message.Substring(0,[Math]::Min(200,$_.Message.Length)) } }} ${J(2)}`],
  network: ['NetAdapter/NetIPConfiguration/NetRoute/DnsClientServerAddress', `${SAFE} [pscustomobject]@{adapters=@(Get-NetAdapter | Select-Object Name,InterfaceDescription,Status,LinkSpeed,MediaType,PhysicalMediaType,DriverVersion,DriverDate,MacAddress,ifIndex);wol=@(Get-NetAdapterPowerManagement | Select-Object Name,WakeOnMagicPacket,WakeOnPattern,DeviceSleepOnDisconnect,AllowComputerToTurnOffDevice);ip=@(Get-NetIPConfiguration | Select-Object InterfaceAlias,@{n='ipv4';e={$_.IPv4Address.IPAddress}},@{n='gateway';e={$_.IPv4DefaultGateway.NextHop}},@{n='dns';e={$_.DNSServer.ServerAddresses}});routes=@(Get-NetRoute -AddressFamily IPv4 | Where-Object { $_.DestinationPrefix -eq '0.0.0.0/0' } | Select-Object InterfaceAlias,NextHop,RouteMetric)} ${J(4)}`],
  bios: ['CIM Win32_BIOS/BaseBoard + Confirm-SecureBootUEFI', `${SAFE} $b=Get-CimInstance Win32_BIOS; $m=Get-CimInstance Win32_BaseBoard; [pscustomobject]@{vendor=$b.Manufacturer;version=$b.SMBIOSBIOSVersion;releaseDate=$b.ReleaseDate;board=$m.Product;boardVendor=$m.Manufacturer;secureBoot=$(try{Confirm-SecureBootUEFI}catch{$null});firmware=$env:firmware_type} ${J(3)}`],
  power: ['powercfg /a, /lastwake, /devicequery wake_armed, /waketimers + Win32_Battery', `${SAFE} $pc=Join-Path $env:SystemRoot 'System32\\powercfg.exe'; [pscustomobject]@{sleepStates=@(& $pc /a);lastWake=@(& $pc /lastwake);wakeArmed=@(& $pc /devicequery wake_armed);wakeTimers=@(& $pc /waketimers);activeScheme=@(& $pc /getactivescheme);battery=@(Get-CimInstance Win32_Battery | Select-Object Name,EstimatedChargeRemaining,BatteryStatus)} ${J(3)}`],
  devices: ['PnpDevice USB/Bluetooth/Printer/Disk + Win32_Printer', `${SAFE} [pscustomobject]@{usb=@(Get-PnpDevice -PresentOnly -Class USB,HIDClass,Bluetooth,Image,Camera,AudioEndpoint,Ports | Select-Object Class,FriendlyName,Status);printers=@(Get-CimInstance Win32_Printer | Select-Object Name,PortName,Default,WorkOffline,PrinterStatus);disks=@(Get-PnpDevice -PresentOnly -Class DiskDrive | Select-Object FriendlyName,Status)} ${J(3)}`],
  session: ['quser + LogonUI/explorer presence (logon state)', `${SAFE} [pscustomobject]@{logonUi=[bool](Get-Process LogonUI);lockApp=[bool](Get-Process LockApp | Where-Object { $_.Responding });explorerSessions=@(Get-Process explorer | Select-Object -ExpandProperty SessionId -Unique);consoleUser=(Get-CimInstance Win32_ComputerSystem).UserName -ne $null;quser=@(& (Join-Path $env:SystemRoot 'System32\\quser.exe') 2>$null)} ${J(3)}`],
  autostart_nexus: ['ScheduledTasks NEXUS-* + Run keys mentioning nexus', `${SAFE} [pscustomobject]@{tasks=@(Get-ScheduledTask | Where-Object { $_.TaskName -like 'NEXUS*' } | ForEach-Object { $i=$_ | Get-ScheduledTaskInfo; [pscustomobject]@{name=$_.TaskName;state=[string]$_.State;triggers=@($_.Triggers | ForEach-Object { $_.CimClass.CimClassName });runAs=$_.Principal.UserId;lastRun=$i.LastRunTime;lastResult=$i.LastTaskResult} });runKeys=@(foreach($k in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'){ $p=Get-ItemProperty $k; if($p){ $p.PSObject.Properties | Where-Object { $_.Name -like '*nexus*' -or "$($_.Value)" -like '*nexus*' } | ForEach-Object { [pscustomobject]@{key=$k;name=$_.Name} } } });processes=@(Get-Process node,cloudflared,java | Select-Object Name,Id,SessionId,StartTime)} ${J(4)}`],
});

function runPs(script, {systemRoot = process.env.SystemRoot || 'C:\\Windows', timeoutMs = 45_000} = {}) {
  const ps = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${script}`],
      {windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024}, (err, stdout) => {
        if (err && !stdout) return reject(Error(err.killed ? 'diagnostics_timeout' : 'diagnostics_failed'));
        resolve(String(stdout).trim());
      });
  });
}

const iso = () => { const d = new Date(), o = -d.getTimezoneOffset(), p = n => String(Math.abs(n)).padStart(2, '0');
  return new Date(d.getTime() + o * 60_000).toISOString().replace('Z', '') .slice(0, 19) + (o >= 0 ? '+' : '-') + p(Math.trunc(o / 60)) + ':' + p(o % 60); };

export function createDiag({caps, platform = process.platform, run = runPs} = {}) {
  return {
    async system_info(args = {}) {
      if (caps.diagnostics === false) throw Error('capability_disabled');
      if (!onlyKeys(args, ['topic', 'filter', 'limit'])) throw Error('invalid_args');
      if (!Object.hasOwn(TOPICS, args.topic)) throw Error('invalid_args: topic must be one of ' + Object.keys(TOPICS).join(', '));
      if (args.filter !== undefined && (typeof args.filter !== 'string' || args.filter.length > 60)) throw Error('invalid_args');
      const limit = args.limit ?? 200; if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw Error('invalid_args');
      if (platform !== 'win32') throw Error('windows_only');
      const [source, script] = TOPICS[args.topic];
      const raw = await run(script);
      let data; try { data = raw ? JSON.parse(raw) : null; } catch { data = {unparsed: redactSecrets(raw.slice(0, 4000)).text}; }
      let truncated = false;
      if (Array.isArray(data)) {
        if (args.filter) { const f = args.filter.toLowerCase(); data = data.filter(x => JSON.stringify(x).toLowerCase().includes(f)); }
        if (data.length > limit) { data = data.slice(0, limit); truncated = true; }
      }
      if (args.topic === 'events' && Array.isArray(data)) data = data.map(e => ({...e, message: e.message ? redactSecrets(String(e.message)).text : e.message}));
      return {topic: args.topic, source, collectedAt: iso(), truncated, data};
    },
  };
}
