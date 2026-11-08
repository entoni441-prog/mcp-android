/**
 * OS task definition only. Does not register/elevate/run anything.
 * The Task Scheduler action is one pinned native executable, NOT node.exe.
 * Owner must approve initial administrator provisioning through Windows UAC.
 */
export const BROKER_TASK_NAME='NEXUS-Installer-Broker';
export const BROKER_ROOT='C:\\Program Files\\NEXUS\\InstallerBroker';
export const BROKER_RUNNER=BROKER_ROOT+'\\run-once.mjs';
export const BROKER_LAUNCHER=BROKER_ROOT+'\\NEXUS-Broker-Launcher.exe';
const xmlEscape = s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function generateTaskXml({ownerSid,launcher=BROKER_LAUNCHER}={}){
  if(!/^S-1-5-21-(?:[0-9]+-){3}[0-9]+$/.test(ownerSid||''))
    throw Error('invalid_owner_sid');
  if(launcher!==BROKER_LAUNCHER)throw Error('broker_executable_must_be_pinned');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>NEXUS Installer Broker: one owner-UAC-provisioned, allowlisted installer action. Never model shell.</Description></RegistrationInfo>
  <Triggers><TimeTrigger><StartBoundary>2035-01-01T00:00:00</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>
  <Principals><Principal id="Owner"><UserId>${xmlEscape(ownerSid)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><StartWhenAvailable>false</StartWhenAvailable><AllowStartOnDemand>true</AllowStartOnDemand><ExecutionTimeLimit>PT6M</ExecutionTimeLimit><Enabled>true</Enabled></Settings>
  <Actions Context="Owner"><Exec><Command>${xmlEscape(launcher)}</Command><WorkingDirectory>${xmlEscape(BROKER_ROOT)}</WorkingDirectory></Exec></Actions>
</Task>`;
}
