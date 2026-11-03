/**
 * NEXUS NEXT — files outside the workspace (FR-04, NX-052-16) and download/verify (FR-05, NX-052-17/20).
 *
 * files_scoped works on ABSOLUTE paths:
 *  - inside an owner task root (capabilities.taskRoots) → autonomous (R2 «paths named by the owner»);
 *  - anywhere else → consent for exactly that operation and path;
 *  - protected resources (.ssh, .env, keys, password stores, owner-marked) → consent with redaction, never autonomous;
 *  - writing an executor file (scripts, hooks, package.json…) → consent with a diff.
 * Write modes: create (expectedSha256 null), edit-copy (writes a sibling copy, original untouched),
 * replace-with-backup (expectedSha256 must match; original copied to <home>/backups first; atomic tmp+rename).
 * Delete moves into <root>/.nexus-trash (recoverable). Directory listing hides protected names.
 *
 * download_verify: https only, public hosts only (literal check + DNS check of every hop, manual redirects ≤5),
 * size cap, SHA-256, Authenticode on Windows. States are explicit: download_requested → download_started →
 * download_completed → hash_verified | hash_mismatch → signature_verified | signature_invalid | signature_absent.
 * The file keeps the Mark of the Web (Zone.Identifier ZoneId=3) so Smart App Control / SmartScreen treat it exactly
 * as a browser download — NEXUS never strips it.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import {execFile} from 'node:child_process';
import {requireCap} from './capabilities.mjs';
import {resourceDecision, writeDecision, isProtectedPath, shortDiff, redactSecrets} from './policy.mjs';
import {urlAllowed} from './browser.mjs';
import {isPublicIp} from './egress-proxy.mjs';

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (a, allowed) => isObj(a) && Object.keys(a).every(k => allowed.includes(k));
const bad = w => { throw Error('invalid_args' + (w ? ': ' + w : '')); };
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const TEXT_EXT = /\.(txt|md|csv|tsv|json|jsonc|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|java|kt|cs|c|cpp|h|go|rs|rb|php|ps1|psm1|bat|cmd|sh|ini|cfg|conf|toml|ya?ml|log|sql|gradle|properties|env|svg)$/i;
const MAX_TEXT_READ = 256 * 1024, MAX_TEXT_WRITE = 1024 * 1024;

export function within(root, p) { const rel = path.relative(path.resolve(root), path.resolve(p)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); }
const absOk = p => typeof p === 'string' && p.length <= 400 && !p.includes('\0') && !p.startsWith('\\\\') && !p.startsWith('//') && (path.win32.isAbsolute(p) || path.posix.isAbsolute(p)) && !/[\\/]\.\.(?:[\\/]|$)/.test(p);

export function createScoped({caps, cfg, consent = null, audit = () => {}, platform = process.platform, fetchFn = fetch, lookup = dns.lookup, now = () => Date.now(),
  sigCheck = null}) {
  const roots = () => (caps.taskRoots || []).map(r => path.resolve(r));
  const rootOf = p => roots().find(r => within(r, p)) || null;
  const backups = path.join(cfg.home, 'backups');

  /** null = go on; otherwise a consent_required result for exactly this op + path. */
  function gate(op, p, run, {diff = null} = {}) {
    const prot = resourceDecision(op === 'write' ? 'modify' : op, p, caps.protectedPaths || []);
    if (prot.level === 2) return consent.requestGrant({what: 'protected_file', target: `${LABEL[op]} защищённого ресурса «${p}» (${prot.reason})${op === 'read' || op === 'list' ? '; прочитанное будет передано в ChatGPT (секреты замаскированы)' : ''}`, apply: run});
    if (op === 'write' && writeDecision(path.basename(p)).level === 3) return {...consent.requestGrant({what: 'executor_file_write', target: `запись NEXUS в исполняемый файл «${p}»${diff ? `: −${diff.removed} / +${diff.added} строк` : ''}`, apply: run}), ...(diff ? {diff} : {})};
    if (!rootOf(p)) return consent.requestGrant({what: 'file_outside_scope', target: `${LABEL[op]} «${p}» — вне папок задачи (taskRoots)`, apply: run});
    return null;
  }
  const LABEL = {list: 'просмотр папки', read: 'чтение', stat: 'свойства', write: 'запись', copy: 'копирование', delete: 'удаление (в .nexus-trash)'};

  async function doOp(a) {
    const p = path.resolve(a.path);
    switch (a.action) {
      case 'list': {
        const ents = fs.readdirSync(p, {withFileTypes: true}).slice(0, 2000);
        const out = []; let hidden = 0;
        for (const e of ents) {
          const f = path.join(p, e.name);
          if (isProtectedPath(f + (e.isDirectory() ? path.sep : ''), caps.protectedPaths || [])) { hidden++; continue; }
          let st = null; try { st = fs.statSync(f); } catch {}
          out.push({name: e.name, type: e.isDirectory() ? 'dir' : 'file', size: st?.size ?? null, mtime: st ? st.mtime.toISOString() : null});
        }
        return {path: p, entries: out.slice(0, a.limit ?? 500), truncated: out.length > (a.limit ?? 500), protectedHidden: hidden};
      }
      case 'stat': { const st = fs.statSync(p); return {path: p, type: st.isDirectory() ? 'dir' : 'file', size: st.size, mtime: st.mtime.toISOString(), ...(st.isFile() && st.size <= 512 * 1024 * 1024 ? {sha256: sha(fs.readFileSync(p))} : {})}; }
      case 'read': {
        const st = fs.statSync(p); if (!st.isFile()) throw Error('not_a_file');
        const buf = fs.readFileSync(p);
        const prot = isProtectedPath(p, caps.protectedPaths || []);
        if (!TEXT_EXT.test(p) || st.size > MAX_TEXT_READ || buf.includes(0)) return {path: p, size: st.size, sha256: sha(buf), text: null, note: 'Binary or large file: content not returned. Open it in its app (open_app/GUI) or process it with run_command.'};
        return {path: p, size: st.size, sha256: sha(buf), text: redactSecrets(buf.toString('utf8')).text, ...(prot ? {redacted: true} : {})};
      }
      case 'write': {
        const content = Buffer.from(a.content, 'utf8');
        if (content.length > MAX_TEXT_WRITE) throw Error('content_too_large');
        const exists = fs.existsSync(p);
        if (a.mode === 'edit-copy') {
          if (!exists) throw Error('not_found');
          const ext = path.extname(p), dest = path.join(path.dirname(p), `${path.basename(p, ext)}.nexus-copy-${new Date(now()).toISOString().replace(/[:.]/g, '-')}${ext}`);
          fs.writeFileSync(dest, content, {flag: 'wx'});
          return {path: dest, original: p, originalUntouched: true, sha256: sha(content), mode: 'edit-copy'};
        }
        if (!exists) {
          if (a.expectedSha256 !== null) throw Error('expected_sha256_mismatch: the file does not exist (use expectedSha256 null to create)');
          fs.mkdirSync(path.dirname(p), {recursive: true});
          fs.writeFileSync(p, content, {flag: 'wx'});
          return {path: p, created: true, sha256: sha(content)};
        }
        const old = fs.readFileSync(p);
        if (a.expectedSha256 !== sha(old)) throw Error('expected_sha256_mismatch: the file changed since it was read — read it again, nothing was written');
        const bdir = path.join(backups, new Date(now()).toISOString().replace(/[:.]/g, '-')); fs.mkdirSync(bdir, {recursive: true});
        const backup = path.join(bdir, path.basename(p)); fs.copyFileSync(p, backup, fs.constants.COPYFILE_EXCL);
        const tmp = p + '.nexus-tmp-' + crypto.randomBytes(3).toString('hex');
        fs.writeFileSync(tmp, content, {flag: 'wx'}); fs.renameSync(tmp, p);
        audit({event: 'scoped_write', path: p, backup});
        return {path: p, replaced: true, sha256: sha(content), previousSha256: sha(old), backup, diff: shortDiff(old.toString('utf8'), a.content), restore: `files_scoped copy from «${backup}» back to «${p}»`};
      }
      case 'copy': {
        const to = path.resolve(a.to);
        const st = fs.statSync(p); if (!st.isFile()) throw Error('not_a_file');
        if (st.size > (caps.limits?.maxCopyMB ?? 50) * 1024 * 1024) throw Error('file_too_large');
        fs.mkdirSync(path.dirname(to), {recursive: true});
        fs.copyFileSync(p, to, fs.constants.COPYFILE_EXCL);
        return {from: p, to, sha256: sha(fs.readFileSync(to)), overwritten: false};
      }
      case 'delete': {
        const root = rootOf(p) || path.dirname(p);
        const trash = path.join(root, '.nexus-trash', new Date(now()).toISOString().replace(/[:.]/g, '-')); fs.mkdirSync(trash, {recursive: true});
        const dest = path.join(trash, path.basename(p)); fs.renameSync(p, dest);
        return {path: p, movedTo: dest, recoverable: true};
      }
      default: bad('action');
    }
  }

  async function publicHost(u) {
    const h = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(h)) return isPublicIp(h);
    let addrs; try { addrs = await lookup(h, {all: true}); } catch { return false; }
    return addrs.length > 0 && addrs.every(x => isPublicIp(x.address));
  }

  function verifySignature(file) {
    if (sigCheck) return sigCheck(file);
    if (platform !== 'win32') return Promise.resolve({status: 'not_checked_non_windows'});
    // The path reaches PowerShell through an environment variable, never as script text.
    const ps = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = "$s=Get-AuthenticodeSignature -LiteralPath $env:NEXUS_SIG_FILE; [pscustomobject]@{status=[string]$s.Status;signer=$s.SignerCertificate.Subject;thumbprint=$s.SignerCertificate.Thumbprint;timeStamped=[bool]$s.TimeStamperCertificate} | ConvertTo-Json -Compress";
    return new Promise(res => execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', script], {windowsHide: true, timeout: 30_000, env: {...process.env, NEXUS_SIG_FILE: file}},
      (err, out) => { try { res(JSON.parse(String(out))); } catch { res({status: 'check_failed'}); } }));
  }

  return {
    async files_scoped(args = {}, {consented = false} = {}) {
      if (!onlyKeys(args, ['action', 'path', 'to', 'content', 'expectedSha256', 'mode', 'limit'])) bad();
      if (!['list', 'stat', 'read', 'write', 'copy', 'delete'].includes(args.action)) bad('action');
      if (!absOk(args.path)) bad('path must be absolute, local, without ..');
      if (args.action === 'copy' && !absOk(args.to)) bad('to');
      if (args.action === 'write') {
        if (typeof args.content !== 'string') bad('content');
        if (!['create-or-replace', 'edit-copy', 'replace-with-backup', undefined].includes(args.mode)) bad('mode');
        if (args.mode !== 'edit-copy' && !(args.expectedSha256 === null || (typeof args.expectedSha256 === 'string' && /^[a-f0-9]{64}$/.test(args.expectedSha256)))) bad('expectedSha256 (null to create, current sha256 to replace)');
      }
      if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 2000)) bad('limit');
      const run = () => doOp(args);
      if (consented) return run();
      const op = args.action === 'stat' ? 'read' : args.action;
      let diff = null;
      if (args.action === 'write') { try { diff = shortDiff(fs.readFileSync(args.path, 'utf8'), args.content); } catch {} }
      const g = gate(op, args.path, () => this.files_scoped(args, {consented: true}), {diff});
      if (g) return g;
      if (args.action === 'copy') { const g2 = gate('write', args.to, () => this.files_scoped(args, {consented: true})); if (g2) return g2; }
      return run();
    },

    async download_verify(args = {}) {
      requireCap(caps, 'commands');
      if (!onlyKeys(args, ['url', 'sha256', 'filename', 'expectedSigner', 'maxMB'])) bad();
      if (typeof args.url !== 'string' || !args.url.startsWith('https://') || !urlAllowed(args.url)) throw Error('url_not_allowed: https on a public host only');
      if (args.sha256 !== undefined && !(typeof args.sha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(args.sha256))) bad('sha256');
      if (args.filename !== undefined && !(typeof args.filename === 'string' && /^[\w.() -]{1,120}$/.test(args.filename) && !args.filename.startsWith('.'))) bad('filename');
      if (args.expectedSigner !== undefined && (typeof args.expectedSigner !== 'string' || args.expectedSigner.length > 200)) bad('expectedSigner');
      const maxMB = args.maxMB ?? (caps.limits?.maxCopyMB ?? 50); if (!Number.isInteger(maxMB) || maxMB < 1 || maxMB > 2048) bad('maxMB');
      const states = [{state: 'download_requested', at: new Date(now()).toISOString()}];
      const add = (state, extra = {}) => states.push({state, at: new Date(now()).toISOString(), ...extra});
      let url = args.url, r;
      for (let hop = 0; ; hop++) {
        const u = new URL(url);
        if (u.protocol !== 'https:' || !urlAllowed(url) || !(await publicHost(u))) { add('download_refused', {reason: 'private_or_non_https_hop', host: u.host}); return {states, downloaded: false}; }
        r = await fetchFn(url, {redirect: 'manual', signal: AbortSignal.timeout(120_000)});
        if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.get('location') && hop < 5) { url = new URL(r.headers.get('location'), url).href; continue; }
        break;
      }
      if (!r.ok) { add('download_failed', {http: r.status}); return {states, downloaded: false, finalUrl: url}; }
      const name = args.filename || decodeURIComponent(new URL(url).pathname.split('/').pop() || 'download.bin').replace(/[^\w.() -]/g, '_').slice(0, 120) || 'download.bin';
      const dir = path.join(cfg.workspace, 'downloads'); fs.mkdirSync(dir, {recursive: true});
      let file = path.join(dir, name); if (fs.existsSync(file)) file = path.join(dir, `${Date.now()}-${name}`);
      add('download_started', {finalUrl: url});
      const h = crypto.createHash('sha256'); let bytes = 0;
      const out = fs.createWriteStream(file, {flags: 'wx'});
      try {
        for await (const chunk of r.body) { bytes += chunk.length; if (bytes > maxMB * 1024 * 1024) throw Error('download_too_large'); h.update(chunk); if (!out.write(chunk)) await new Promise(res => out.once('drain', res)); }
        await new Promise((res, rej) => out.end(e => (e ? rej(e) : res())));
      } catch (e) { out.destroy(); try { fs.rmSync(file); } catch {} add('download_failed', {reason: String(e.message).slice(0, 80)}); return {states, downloaded: false}; }
      const digest = h.digest('hex');
      add('download_completed', {bytes});
      // Mark of the Web: keep the same protection a browser download gets (Smart App Control / SmartScreen).
      if (platform === 'win32') { try { fs.writeFileSync(file + ':Zone.Identifier', `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=${new URL(url).origin}/\r\n`); add('mark_of_the_web_set'); } catch { add('mark_of_the_web_failed'); } }
      if (args.sha256) add(digest === args.sha256.toLowerCase() ? 'hash_verified' : 'hash_mismatch', {expected: args.sha256.toLowerCase()});
      let signature = null;
      if (/\.(exe|msi|msix|appx|dll|sys|ps1|cat)$/i.test(file)) {
        signature = await verifySignature(file);
        const signerOk = !args.expectedSigner || String(signature?.signer || '').toLowerCase().includes(args.expectedSigner.toLowerCase());
        add(signature?.status === 'Valid' && signerOk ? 'signature_verified' : signature?.status === 'NotSigned' ? 'signature_absent' : signature?.status === 'not_checked_non_windows' ? 'signature_not_checked' : 'signature_invalid', {status: signature?.status, signer: signature?.signer || null});
      }
      const hashOk = !args.sha256 || digest === args.sha256.toLowerCase();
      if (!hashOk) { const q = path.join(cfg.workspace, 'downloads', '.quarantine'); fs.mkdirSync(q, {recursive: true}); const dest = path.join(q, path.basename(file)); fs.renameSync(file, dest); file = dest; add('quarantined'); }
      audit({event: 'download', host: new URL(url).host, bytes, sha256: digest.slice(0, 16), states: states.map(s => s.state)});
      return {downloaded: true, file: path.relative(cfg.workspace, file).split(path.sep).join('/'), bytes, sha256: digest, finalUrl: url, states, signature,
        verified: hashOk && (!signature || states.some(s => s.state === 'signature_verified')),
        note: 'Downloaded is not installed. Install with run_command (winget, R2) or the installer (R3 consent); the Mark of the Web stays on the file.'};
    },
  };
}
