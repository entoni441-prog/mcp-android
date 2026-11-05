/**
 * NEXUS Host 0.5.2 — N-01 discovery of installed applications (read-only).
 * Source: Start Menu shortcuts of all users + the current user (what the owner sees in Start). Each .lnk is resolved
 * with WScript.Shell; only targets that are local absolute .exe files and pass policy.launchableExe are kept.
 * Shortcut ARGUMENTS are ignored on purpose: NEXUS launches the bare .exe (a shortcut could carry any command line).
 * UWP/Store apps (no .exe target) are not listed yet — Calculator keeps its own path in apps.mjs.
 */
import {spawn} from 'node:child_process';
import path from 'node:path';
import {launchableExe, classifyApp} from './policy.mjs';

const PS = `$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$sh = New-Object -ComObject WScript.Shell
$roots = @("$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs", "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs")
$out = [System.Collections.Generic.List[object]]::new()
foreach ($r in $roots) { Get-ChildItem -LiteralPath $r -Recurse -Filter *.lnk -File | Select-Object -First 1500 | ForEach-Object {
  $t = $sh.CreateShortcut($_.FullName).TargetPath
  if ($t) { $out.Add([pscustomobject]@{name=$_.BaseName; exe=$t}) } } }
# 0.6.1d NX-052-03: discover AppX / Store packages (e.g. ChatGPT) enumerated via Get-StartApps
try {
  $pkgs = @{}
  Get-AppxPackage | ForEach-Object { if ($_.PackageFamilyName) { $pkgs[$_.PackageFamilyName] = $_ } }
  Get-StartApps | Where-Object { $_.AppID -like '*!*' } | ForEach-Object {
    $parts = $_.AppID -split '!', 2
    $pkg = $pkgs[$parts[0]]
    if ($pkg -and $pkg.InstallLocation) {
      try {
        $m = Get-AppxPackageManifest $pkg
        $app = @($m.Package.Applications.Application) | Where-Object { $_.Id -eq $parts[1] } | Select-Object -First 1
        if ($app -and $app.Executable) {
          $exe = Join-Path $pkg.InstallLocation ($app.Executable -replace '/', '\\')
          if (Test-Path -LiteralPath $exe) { $out.Add([pscustomobject]@{name=$_.Name; exe=$exe}) }
        }
      } catch {}
    }
  }
} catch {}
$out | ConvertTo-Json -Compress`;

/** Lowercase slug usable as open_app {app} (pattern ^[a-z0-9][a-z0-9_-]{0,39}$). */
export function slug(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

const NOISE = /(uninstall|удалить|деинсталл|disinstalla|readme|help|справка|documentation|website|license|release notes|changelog)/i;

/** Pure: raw [{name, exe}] → [{app, name, exe, cls}], deduped, denied/unsafe removed, reserved names skipped. */
export function buildIndex(raw, reserved = ['notepad', 'calculator', 'explorer', 'file-explorer']) {
  const seenExe = new Set(), used = new Set(reserved), out = [];
  for (const r of Array.isArray(raw) ? raw : raw ? [raw] : []) {
    if (!r || typeof r.name !== 'string' || typeof r.exe !== 'string') continue;
    if (NOISE.test(r.name) || !launchableExe(r.exe)) continue;
    if (/^(notepad|calc|calculatorapp|explorer)\.exe$/i.test(path.win32.basename(r.exe))) continue; // own paths in apps.mjs (A-02 rule, UWP)
    const key = r.exe.toLowerCase();
    if (seenExe.has(key)) continue;
    let app = slug(r.name);
    if (!app || !/^[a-z0-9]/.test(app)) continue;
    if (used.has(app)) { let i = 2; while (used.has(`${app.slice(0, 37)}-${i}`)) i++; app = `${app.slice(0, 37)}-${i}`; }
    seenExe.add(key); used.add(app);
    out.push({app, name: r.name.slice(0, 80), exe: r.exe, cls: classifyApp(path.win32.basename(r.exe)).cls});
  }
  return out.sort((a, b) => a.app.localeCompare(b.app));
}

export function createDiscovery({platform = process.platform, systemRoot = process.env.SystemRoot, run = runPs, ttlMs = 5 * 60_000, now = () => Date.now()} = {}) {
  let cache = null, at = 0;
  return {
    async list(force = false) {
      if (platform !== 'win32') return [];
      if (!force && cache && now() - at < ttlMs) return cache;
      const text = await run(PS, systemRoot);
      let raw = []; try { raw = text.trim() ? JSON.parse(text) : []; } catch { raw = []; }
      cache = buildIndex(raw); at = now();
      return cache;
    },
    async find(app) { return (await this.list()).find(x => x.app === app) || (await this.list(true)).find(x => x.app === app) || null; },
  };
}

function runPs(script, systemRoot, timeoutMs = 30_000) {
  if (typeof systemRoot !== 'string' || !/^[a-zA-Z]:\\/.test(systemRoot)) return Promise.reject(Error('invalid_windows_system_root'));
  const exe = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    const p = spawn(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true});
    let out = '';
    const t = setTimeout(() => { p.kill(); reject(Error('discovery_timeout')); }, timeoutMs);
    p.stdout.setEncoding('utf8'); p.stdout.on('data', c => { if (out.length < 4e6) out += c; });
    p.once('error', () => { clearTimeout(t); reject(Error('powershell_launch_failed')); });
    p.once('exit', () => { clearTimeout(t); resolve(out); });
  });
}
