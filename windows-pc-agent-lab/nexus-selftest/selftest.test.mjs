import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateNexusSnapshot} from './selftest.mjs';

const healthy = () => ({
  connection_status: {gateway: 'ok', tunnelProbe: {status: 200}, verdict: 'online'},
  host_diagnostics: {hostPid: 123, tunnel: {cloudflaredAlive: true}, pendingConsents: 0, capabilitiesFileError: null},
  get_capabilities: {grants: {power: false, ownerBans: ['power'], fileError: null}},
});
const status = (s, id) => evaluateNexusSnapshot(s).checks.find(c => c.id === id).status;

test('healthy snapshot passes without mutation', () => {
  const s = healthy(); const before = structuredClone(s);
  assert.equal(evaluateNexusSnapshot(s).overall, 'PASS');
  assert.ok(evaluateNexusSnapshot(s).checks.every(c => c.status === 'PASS'));
  assert.deepEqual(s, before);
});
test('timeout fails; recovered reconnect warns', () => {
  const s = healthy(); s.connection_status.tunnelProbe = {status: 0, error: 'timeout'};
  s.connection_status.verdict = 'tunnel_down_or_reconnecting';
  assert.equal(evaluateNexusSnapshot(s).overall, 'FAIL');
  s.connection_status = {gateway: 'ok', tunnelProbe: {status: 200}, verdict: 'online_with_recent_reconnects'};
  assert.equal(evaluateNexusSnapshot(s).overall, 'WARN');
});
test('offline Gateway fails even with online verdict', () => {
  for (const code of [0, 401, 503, '200', null]) {
    const s = healthy(); s.connection_status.tunnelProbe.status = code;
    assert.equal(status(s, 'gateway_http'), 'FAIL');
  }
  const s = healthy(); s.connection_status.gateway = 'offline';
  assert.equal(evaluateNexusSnapshot(s).overall, 'FAIL');
});
test('both power restriction conditions are mandatory', () => {
  for (const grants of [{power: true, ownerBans: ['power']}, {power: false, ownerBans: []},
    {power: 'false', ownerBans: ['power']}, {power: false, ownerBans: 'power'}]) {
    const s = healthy(); Object.assign(s.get_capabilities.grants, grants);
    assert.equal(status(s, 'power_ban'), 'FAIL');
  }
});
test('pending consent warns, invalid counts fail, failures dominate warnings', () => {
  const s = healthy(); s.host_diagnostics.pendingConsents = 1;
  assert.equal(evaluateNexusSnapshot(s).overall, 'WARN');
  s.host_diagnostics.hostPid = 0;
  assert.equal(evaluateNexusSnapshot(s).overall, 'FAIL');
  for (const count of [-1, 0.5, '0', null, NaN, Infinity]) {
    s.host_diagnostics.pendingConsents = count;
    assert.equal(status(s, 'pending_consents'), 'FAIL');
  }
});
test('missing required fields and malformed roots never pass', () => {
  for (const value of [undefined, null, [], 'text', {}, 0]) assert.equal(evaluateNexusSnapshot(value).overall, 'FAIL');
  for (const path of [['connection_status'], ['host_diagnostics'], ['get_capabilities'],
    ['connection_status', 'gateway'], ['connection_status', 'tunnelProbe'], ['connection_status', 'verdict'],
    ['host_diagnostics', 'hostPid'], ['host_diagnostics', 'tunnel'], ['host_diagnostics', 'pendingConsents'],
    ['host_diagnostics', 'capabilitiesFileError'], ['get_capabilities', 'grants', 'power'],
    ['get_capabilities', 'grants', 'ownerBans'], ['get_capabilities', 'grants', 'fileError']]) {
    const s = healthy(); let parent = s;
    for (const part of path.slice(0, -1)) parent = parent[part];
    delete parent[path.at(-1)];
    assert.equal(evaluateNexusSnapshot(s).overall, 'FAIL', path.join('.'));
  }
});
test('invalid PID, tunnel, verdict and configuration fail closed', () => {
  for (const pid of [0, -1, 1.2, '123', Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const s = healthy(); s.host_diagnostics.hostPid = pid;
    assert.equal(status(s, 'host_pid'), 'FAIL');
  }
  const s = healthy(); s.host_diagnostics.tunnel.cloudflaredAlive = 'true';
  assert.equal(status(s, 'tunnel_alive'), 'FAIL');
  s.connection_status.verdict = 'unknown';
  assert.equal(status(s, 'connection_verdict'), 'FAIL');
  for (const error of ['invalid_config', false, {}, undefined]) {
    const d = healthy(); d.host_diagnostics.capabilitiesFileError = error;
    assert.equal(status(d, 'configuration'), 'FAIL');
    const c = healthy(); c.get_capabilities.grants.fileError = error;
    assert.equal(status(c, 'configuration'), 'FAIL');
  }
});
test('secret canaries never appear in safe reports, including error paths', () => {
  const canary = 'SYNTHETIC_SECRET_CANARY_9f3';
  const s = healthy(); s.token = canary; s.password = canary;
  s.host_diagnostics.token = canary; s.get_capabilities.grants.password = canary;
  assert.deepEqual(evaluateNexusSnapshot(s), evaluateNexusSnapshot(healthy()));
  s.host_diagnostics.capabilitiesFileError = canary;
  s.connection_status.verdict = canary;
  s.get_capabilities.grants.ownerBans.push(canary);
  const report = evaluateNexusSnapshot(s);
  assert.equal(report.overall, 'FAIL');
  assert.ok(!JSON.stringify(report).includes(canary));
  assert.deepEqual(Object.keys(report), ['overall', 'checks']);
  for (const check of report.checks) assert.deepEqual(Object.keys(check), ['id', 'status', 'reason']);
});
