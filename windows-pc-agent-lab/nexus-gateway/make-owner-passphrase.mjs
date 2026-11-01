#!/usr/bin/env node
// Generates the owner passphrase for the NEXUS consent page.
// Writes the passphrase and its SHA-256 to %USERPROFILE%\.nexus-host\ ; prints neither.
// Save the passphrase in Bitwarden, then delete owner-passphrase.txt.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = process.env.NEXUS_HOME || path.join(os.homedir(), '.nexus-host');
fs.mkdirSync(home, {recursive: true});
const pass = path.join(home, 'owner-passphrase.txt');
if (fs.existsSync(pass)) { console.error('owner-passphrase.txt already exists — not overwriting.'); process.exit(1); }
const words = crypto.randomBytes(18).toString('base64url'); // 144 bits
fs.writeFileSync(pass, words, {mode: 0o600, flag: 'wx'});
fs.writeFileSync(path.join(home, 'owner-passphrase.sha256'), crypto.createHash('sha256').update(words).digest('hex'), {mode: 0o600});
console.log('Created owner-passphrase.txt and owner-passphrase.sha256 in ' + home);
