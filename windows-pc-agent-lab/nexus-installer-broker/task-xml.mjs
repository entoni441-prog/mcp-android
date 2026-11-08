/**
 * Windows Task Scheduler template for first-time, OWNER-elevated onboarding.
 * THIS MODULE DOES NOT REGISTER OR RUN A TASK.
 * Creating a HighestAvailable task requires an already elevated Windows token.
 *
 * The task's action is one immutable, admin-owned run-once script. Never accept
 * a command line, installer path or arguments from ChatGPT or the Live widget.
 */
export const BROKER_TASK_NAME='NEXUS-Installer-Broker';
export const BROKER_RUNNER='C:\\Program Files\\NEXUS\\InstallerBroker\\run-once.mjs';
export const NODE_PATH='C:\\Program Files\\nodejs\\node.exe';
const escapeXml=v=>v.replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function generateTaskXml({ownerSid,taskRunner=BROKER_RUNNER,node=NODE_PATH}={}){
  if(!/^S-1-5-21-(?:[0-9]+-){3}[0-9]+$/.test(ownerSid||''))
    throw Error('invalid_owner_sid');
  if(taskRunner!==BROKER_RUNNER||node!==NODE_PATH)
    throw Error('broker_executable_must_be_pinned');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>NEXUS restricted installer broker. Requires owner UAC at provisioning, never runs model commands.</Description></RegistrationInfo>
  <Triggers><TimeTrigger><StartBoundary>2035-01-01T00:00:00</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>
  <Principals><Principal id="Owner"><UserId>${escapeXml(ownerSid)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><StartWhenAvailable>false</StartWhenAvailable><AllowStartOnDemand>true</AllowStartOnDemand><ExecutionTimeLimit>PT5M</ExecutionTimeLimit><Enabled>true</Enabled></Settings>
  <Actions Context="Owner"><Exec><Command>${escapeXml(node)}</Command><Arguments>&quot;${escapeXml(taskRunner)}&quot; --run-once</Arguments><WorkingDirectory>C:\\Program Files\\NEXUS\\InstallerBroker</WorkingDirectory></Exec></Actions>
</Task>`;
}
