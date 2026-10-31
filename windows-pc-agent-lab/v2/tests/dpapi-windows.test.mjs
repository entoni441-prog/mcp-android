// Windows-only automated test of the exact Agent DPAPI implementation.
// Synthetic fixture only, no real credentials, no network, no enrollment.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../windows-agent-v2.mjs',import.meta.url),'utf8');
const match=source.match(/(function dpapi\(mode,plaintextOrCiphertext\)\{[\s\S]*?\n\})\n\nfunction saveIdentity/);
assert.ok(match,'DPAPI implementation missing or moved; update test extraction safely');
assert.match(match[1],/Add-Type -AssemblyName System.Security -ErrorAction Stop/);
// Test the same exact function body the user runs, not a duplicate test implementation.
const dpapi=new Function('spawnSync','Buffer',match[1]+'\nreturn dpapi;')(spawnSync,Buffer);
test('Windows DPAPI CurrentUser encrypt/decrypt round trip',()=>{
  assert.equal(process.platform,'win32');
  const sample='DPAPI-SYNTHETIC-ROUNDTRIP-NO-SECRETS';
  const cipher=dpapi('protect',sample);
  assert.match(cipher,/^[A-Za-z0-9+/]+={0,2}$/);
  assert.notEqual(cipher,sample);
  assert.equal(dpapi('unprotect',cipher),sample);
});
