#!/usr/bin/env node
/**
 * NEXUS Sentinel (NEXUS NEXT, architecture §4.3 «слой 0»). Runs as a Windows Scheduled Task at system START (SYSTEM,
 * before anyone signs in). It has NO input, NO screen capture, NO commands and stores NO passwords: every 60 s it
 * reports one word — booting | logon_screen | locked | user_session | host_up — plus boot time to the gateway, so
 * the gateway can answer «awaiting_owner_logon» instead of a faceless pc_offline. Sign-in is always the owner's.
 *
 * Config (owner/installer, outside any NEXUS tool): %ProgramData%\NEXUS\sentinel.json
 *   {"gatewayUrl":"https://<gateway>.workers.dev","hostHealthUrl":"http://127.0.0.1:8765/healthz"}
 * Token: %ProgramData%\NEXUS\sentinel-token.txt (= gateway secret SENTINEL_TOKEN; ACL SYSTEM+Administrators).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';

/** Pure: Windows facts → state word. */
export function classifyLogonState({uptimeSec = 0, logonUi = false, activeSession = false, hostUp = false}) {
  if (hostUp) return 'host_up';
  if (activeSession && logonUi) return 'locked';
  if (activeSession) return 'user_session';
  if (logonUi) return 'logon_screen';
  return uptimeSec < 180 ? 'booting' : 'logon_screen_or_unknown';
}

/** Pure: parse `quser` output → is there an Active session? (column «STATE» = Active, any language prints "Active"). */
export const activeFromQuser = out => String(out).split(/\r?\n/).slice(1).some(l => /\bActive\b|\bАктивн/i.test(l));

const sys = f => path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', f);
const run = (exe, args) => new Promise(res => execFile(exe, args, {windowsHide: true, timeout: 15_000}, (e, out) => res(String(out || ''))));

export async function collect({hostHealthUrl, fetchFn = fetch} = {}) {
  const [tl, qu] = await Promise.all([run(sys('tasklist.exe'), ['/FI', 'IMAGENAME eq LogonUI.exe', '/NH']), run(sys('quser.exe'), [])]);
  let hostUp = false, hostVersion = null;
  try { const r = await fetchFn(hostHealthUrl, {signal: AbortSignal.timeout(4000)}); if (r.ok) { const j = await r.json(); hostUp = j?.ok === true; hostVersion = j?.version || null; } } catch {}
  const facts = {uptimeSec: Math.round(os.uptime()), logonUi: /LogonUI\.exe/i.test(tl), activeSession: activeFromQuser(qu), hostUp};
  return {state: classifyLogonState(facts), bootAt: new Date(Date.now() - os.uptime() * 1000).toISOString(), at: new Date().toISOString(), hostVersion};
}

async function main() {
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'NEXUS');
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'sentinel.json'), 'utf8'));
  const token = fs.readFileSync(path.join(dir, 'sentinel-token.txt'), 'utf8').trim();
  if (!/^https:\/\/[a-z0-9.-]+$/.test(cfg.gatewayUrl) || !/^http:\/\/127\.0\.0\.1:\d+\/healthz$/.test(cfg.hostHealthUrl) || token.length < 32) throw Error('bad_sentinel_config');
  for (;;) {
    try {
      const body = await collect({hostHealthUrl: cfg.hostHealthUrl});
      await fetch(cfg.gatewayUrl + '/sentinel', {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + token}, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000)});
    } catch { /* network not up yet — next round */ }
    await new Promise(r => setTimeout(r, 60_000));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(String(e?.message || e)); process.exit(1); });
