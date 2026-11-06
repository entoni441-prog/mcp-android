// Noncommercial, read-only evaluation of an explicitly supplied data snapshot.
// No I/O and no input values are copied into the report.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => record(value) && Object.hasOwn(value, key) ? value[key] : undefined;

export function evaluateNexusSnapshot(snapshot) {
  const connection = own(snapshot, 'connection_status');
  const diagnostics = own(snapshot, 'host_diagnostics');
  const grants = own(own(snapshot, 'get_capabilities'), 'grants');
  const checks = [];
  const add = (id, status, reason) => checks.push({id, status, reason});
  const check = (id, valid, success, failure) => add(id, valid ? 'PASS' : 'FAIL', valid ? success : failure);

  check('gateway_http', own(connection, 'gateway') === 'ok' &&
    own(own(connection, 'tunnelProbe'), 'status') === 200,
  'Gateway probe succeeded.', 'Gateway state or HTTP probe is missing, invalid or unavailable.');
  const verdict = own(connection, 'verdict');
  add('connection_verdict', verdict === 'online' ? 'PASS' :
    verdict === 'online_with_recent_reconnects' ? 'WARN' : 'FAIL',
  verdict === 'online' ? 'Connection is online.' : verdict === 'online_with_recent_reconnects' ?
    'Connection recovered after recent reconnects.' : 'Connection verdict is missing, unknown or not online.');
  const pid = own(diagnostics, 'hostPid');
  check('host_pid', Number.isSafeInteger(pid) && pid > 0,
    'Host PID is valid.', 'Host PID is missing or invalid.');
  check('tunnel_alive', own(own(diagnostics, 'tunnel'), 'cloudflaredAlive') === true,
    'Tunnel process is alive.', 'Tunnel liveness is missing, invalid or false.');
  const bans = own(grants, 'ownerBans');
  check('power_ban', own(grants, 'power') === false && Array.isArray(bans) &&
    bans.every(ban => typeof ban === 'string') && bans.includes('power'),
  'Power is disabled and owner-banned.', 'Power restriction is missing, invalid or violated.');
  const pending = own(diagnostics, 'pendingConsents');
  const validPending = Number.isSafeInteger(pending) && pending >= 0;
  add('pending_consents', !validPending ? 'FAIL' : pending > 0 ? 'WARN' : 'PASS',
    !validPending ? 'Pending consent count is missing or invalid.' : pending > 0 ?
      'Owner consents are pending.' : 'No pending owner consents.');
  check('configuration', own(diagnostics, 'capabilitiesFileError') === null && own(grants, 'fileError') === null,
    'Configuration reports no errors.', 'Configuration error state is missing, invalid or reports an error.');
  return {overall: checks.some(c => c.status === 'FAIL') ? 'FAIL' :
    checks.some(c => c.status === 'WARN') ? 'WARN' : 'PASS', checks};
}
