/** Guard between independently scheduled Host update and recovery watcher.
 * The owner STOP marker stays separate and always wins. Maintenance never grants input.
 */
export const MAINTENANCE_MAX_MS=10*60_000;
export function maintenanceDecision(value,now){
  if(value===null)return {action:'NONE'};
  if(!value||typeof value!=='object'||Array.isArray(value) ||
     Object.keys(value).sort().join(',')!=='beganAt,expiresAt,kind,version' ||
     value.version!==1||value.kind!=='nexus_os_owned_update_v4' ||
     !Number.isSafeInteger(value.beganAt)||!Number.isSafeInteger(value.expiresAt)||
     !Number.isSafeInteger(now)||value.beganAt>now||
     value.expiresAt<=value.beganAt || value.expiresAt-value.beganAt>MAINTENANCE_MAX_MS)
       return {action:'INVALID_STOP'};
  if(now<=value.expiresAt)return {action:'MAINTENANCE_ACTIVE'};
  return {action:'EXPIRED'};
}
