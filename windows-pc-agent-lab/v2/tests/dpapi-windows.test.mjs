// Windows-only automated test of the exact Agent DPAPI implementation.
// Synthetic fixture only, no real credentials, no network, no enrollment.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../windows-agent-v2.mjs',import.meta.url),'utf8');
const start=source.indexOf('function dpapi(mode,plaintextOrCiphertext){');
const end=source.indexOf('function saveIdentity(',start);
assert.ok(start>=0 && end>start,'DPAPI implementation missing or moved');
const implementation=source.slice(start,end).trimEnd();
assert.ok(implementation.endsWith('}'),'DPAPI function end missing');
assert.match(implementation,/Add-Type -AssemblyName System.Security -ErrorAction Stop/);
// Execute the exact implementation, independent of Windows checkout line endings.
const dpapi=new Function('spawnSync','Buffer',implementation+'\nreturn dpapi;')(spawnSync,Buffer);
test('Windows DPAPI CurrentUser encrypt/decrypt round trip',{skip:process.platform!=='win32'},()=>{
  assert.equal(process.platform,'win32');
  const sample='DPAPI-SYNTHETIC-ROUNDTRIP-NO-SECRETS';
  const cipher=dpapi('protect',sample);
  assert.match(cipher,/^[A-Za-z0-9+/]+={0,2}$/);
  assert.notEqual(cipher,sample);
  assert.equal(dpapi('unprotect',cipher),sample);
});
