/**
 * NEXUS Host 0.5.2 — central access policy (pure: no I/O, no Windows calls). Stage 1 of NEXUS-0.5.2-CLAUDE-TASK.md.
 *
 * One place answers «may NEXUS do X to Y, and at which consent level?». gui/apps/files/procs/browser call it in
 * stage 2+ instead of their own allowlists (gui.allowedApp, capabilities.HARD_DENY, procs isAllowedApp).
 *
 * Levels (N-04):  1 = ordinary work, autonomous
 *                 2 = protected resource: consent for THIS resource and THIS operation (read / copy / modify)
 *                 3 = critical: separate confirmation (irreversible, financial, arbitrary command, security pages)
 *          'handoff' = NEXUS cannot/must not do it at all (UAC, credentials, shells) → Owner Handoff (N-03)
 *
 * What the policy can guarantee: it controls only NEXUS's own channels (its input, UIA reads, captures, file API,
 * clipboard, logs). It cannot see what a target app runs by itself (VS Code extensions, git hooks, tasks with
 * runOn:folderOpen). Heuristics marked UNVERIFIED must be checked on the real app before acceptance.
 */
import path from 'node:path';
import crypto from 'node:crypto';
import {isHardDenied} from './capabilities.mjs';

const norm = s => String(s ?? '').toLowerCase().replace(/\.exe$/i, '').trim();

// ── N-01: application classes ────────────────────────────────────────────────────────────────────────────────────
/** Never a NEXUS target. Shells/script hosts = arbitrary code; UAC/logon = security boundary; NEXUS's own runtime. */
export const DENY_APPS = Object.freeze([
  'cmd', 'powershell', 'pwsh', 'powershell_ise', 'windowsterminal', 'wt', 'conhost', 'openconsole', 'bash', 'wsl', 'wslhost',
  'git-bash', 'mintty', 'ssh', 'putty', 'wscript', 'cscript', 'mshta', 'rundll32', 'regsvr32', 'regedit', 'reg', 'msiexec',
  'consent', 'logonui', 'lockapp', 'winlogon', 'credentialuibroker', 'useraccountcontrolsettings', 'dwm', 'csrss', 'lsass',
  'services', 'svchost', 'smss', 'wininit', 'sihost', 'securityhealthsystray', 'securityhealthhost', 'msmpeng', 'secinit',
  'sc', 'schtasks', 'netsh', 'bcdedit', 'diskpart', 'format', 'takeown', 'icacls', 'certutil', 'bitsadmin',
  'node', 'java', 'javaw', 'python', 'pythonw', 'py', 'cloudflared', 'claude',
]);
/** Credential stores: may be shown to the owner, never read/typed into by NEXUS without level-2 consent. */
export const PROTECTED_APPS = Object.freeze(['bitwarden', 'keepass', 'keepassxc', '1password', 'lastpass', 'dashlane', 'keeper', 'enpass', 'roboform']);
/** IDEs: allowed (owner decision 02.11.2026) with the ide input policy below. */
export const IDE_APPS = Object.freeze(['code', 'code - insiders', 'cursor', 'vscodium']);
/** System admin UIs: allowed with page-level bans (N-01 / 0.5.2 checkpoint). */
export const ADMIN_APPS = Object.freeze(['systemsettings', 'control', 'taskmgr', 'mmc']);
/** System maintenance tools: looking is fine, but every input may change the system irreversibly → level 3 per action. */
export const SYSTEM_TOOLS = Object.freeze(['cleanmgr', 'dfrgui', 'msconfig', 'rstrui', 'recoverydrive', 'systempropertiesadvanced',
  'systempropertiesprotection', 'systempropertiesremote', 'systempropertiesperformance', 'optionalfeatures', 'iscsicpl', 'odbcad32',
  'tpminit', 'fsquirt', 'mrt', 'dism', 'sysprep', 'bootim', 'resetengine', 'systemreset']);
/** Shell UI that is not an app window NEXUS should drive (Start, search, taskbar frames). */
const SHELL_UI = Object.freeze(['applicationframehost', 'searchhost', 'startmenuexperiencehost', 'shellexperiencehost', 'textinputhost']);

/** mmc hosts any snap-in (gpedit, services, certificates…): only these consoles are allowed, by window title. */
const MMC_ALLOWED_TITLE = /^(device manager|event viewer|диспетчер устройств|просмотр событий|gestione dispositivi|visualizzatore eventi)(?=$|[^\p{L}])/iu;
/** Settings / Control Panel pages that lower protection or touch accounts/credentials → level 3 (input), see adminPage(). */
const SECURITY_PAGE = /(windows security|безопасность windows|sicurezza di windows|virus|вирус|smart app control|интеллектуальное управление приложениями|controllo intelligente|privacy\s*(&|and)\s*security|конфиденциальность и защита|privacy e sicurezza|sign-in options|варианты входа|opzioni di accesso|accounts?|учетн|учётн|account|user account control|контроль учетных записей|firewall|брандмауэр|bitlocker|credential manager|диспетчер учетных данных|gestione credenziali|for developers|для разработчиков|per sviluppatori|recovery|восстановление|ripristino|windows update|центр обновления)/i;

/**
 * classifyApp('Code') → {cls:'ide', level:1}. Unknown/empty process → deny (fail-closed).
 * `title` is used only for mmc (which snap-in) — titles are untrusted text, so they can only narrow, never widen.
 */
export function classifyApp(proc, {title = ''} = {}) {
  const p = norm(proc);
  if (!p) return {cls: 'deny', level: 'handoff', reason: 'unknown_process'};
  if (DENY_APPS.includes(p)) return {cls: 'deny', level: 'handoff', reason: 'hard_deny'};
  if (SHELL_UI.includes(p)) return {cls: 'deny', level: 'handoff', reason: 'shell_ui'};
  if (PROTECTED_APPS.includes(p)) return {cls: 'protected', level: 2, reason: 'credential_store'};
  if (IDE_APPS.includes(p)) return {cls: 'ide', level: 1};
  if (p === 'mmc') return MMC_ALLOWED_TITLE.test(String(title)) ? {cls: 'admin', level: 1} : {cls: 'admin', level: 'handoff', reason: 'mmc_snapin_not_allowed'};
  if (ADMIN_APPS.includes(p)) return {cls: 'admin', level: 1};
  if (SYSTEM_TOOLS.includes(p)) return {cls: 'system_tool', level: 1};
  if (p === 'explorer') return {cls: 'file_manager', level: 1};
  return {cls: 'ordinary', level: 1};
}

/** Input into an admin UI: security/account pages are level 3 (owner confirms each action); reading them is level 1. */
export function adminPage(proc, {title = '', breadcrumb = ''} = {}) {
  const c = classifyApp(proc, {title});
  if (c.cls !== 'admin') return null;
  if (c.level === 'handoff') return c;
  return SECURITY_PAGE.test(`${title} ${breadcrumb}`) ? {cls: 'admin', level: 3, reason: 'security_page'} : c;
}

/** owner-launchable exe for N-01 discovery: absolute local .exe, not denied/protected-launch-target. */
export function launchableExe(exe) {
  if (typeof exe !== 'string' || exe.length > 400 || exe.includes('\0') || /^[\\/]{2}/.test(exe)) return false;
  if (!/^[a-zA-Z]:\\/.test(exe) || !/\.exe$/i.test(exe)) return false;
  const c = classifyApp(path.win32.basename(exe));
  return c.cls !== 'deny';
}

// ── N-02: protected resources ────────────────────────────────────────────────────────────────────────────────────
/** Built-in protected path patterns (match on normalized forward-slash lowercase path, any depth). */
const PROTECTED_DIRS = ['/.ssh/', '/.gnupg/', '/.aws/', '/.azure/', '/.kube/', '/.docker/', '/.nexus-host/', '/.wrangler/',
  '/.config/gh/', '/appdata/roaming/bitwarden/', '/appdata/local/microsoft/credentials/', '/appdata/roaming/microsoft/credentials/',
  '/appdata/roaming/microsoft/protect/', '/appdata/roaming/microsoft/systemcertificates/'];
const PROTECTED_FILE = /(^|\/)(\.env(\..+)?|\.dev\.vars|\.npmrc|\.pypirc|\.netrc|_netrc|\.git-credentials|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|known_hosts|credentials(\.json)?|secrets?\.(json|ya?ml|toml|txt)|service-account.*\.json|login data|cookies|web data|local state)$/i;
const PROTECTED_EXT = /\.(pem|key|pfx|p12|kdbx|kdb|keychain|ppk|asc|gpg|jks|keystore|ovpn)$/i;
/** Names that by themselves suggest a secret (the A-02 file was «owner-passphrase.txt»). */
const SECRET_NAME = /(passw|парол|passphrase|secret|token|api[-_]?key|private[-_]?key|recovery[-_]?(code|key)|seed|mnemonic|2fa|otp|backup[-_]?codes)/i;

/** Source files named after a concept (tokenizer.js, seed.sql, password-reset.ts) are code, not secrets. */
const SOURCE_EXT = /\.(m?[jt]sx?|cjs|py|java|kt|go|rs|c|cc|cpp|h|hpp|cs|swift|rb|php|sql|md|html|css|scss|vue|svelte|test\.\w+)$/i;

const toKey = p => {
  let s = String(p ?? '').replace(/\\/g, '/').toLowerCase();
  if (!s.startsWith('/')) s = '/' + s;
  return s.replace(/\/+/g, '/');
};
const isDirKey = s => s.endsWith('/');

/**
 * isProtectedPath(p, ownerRoots) → null | {reason}. ownerRoots = absolute paths the owner marked protected.
 * A folder path is protected if it IS or is INSIDE a protected dir. A file is protected by dir, name or extension.
 */
export function isProtectedPath(p, ownerRoots = []) {
  const k = toKey(p);
  const kd = k.endsWith('/') ? k : k + '/';
  for (const r of ownerRoots) {
    const rk = toKey(r).replace(/\/?$/, '/');
    if (kd.startsWith(rk)) return {reason: 'owner_marked'};
  }
  for (const d of PROTECTED_DIRS) if (kd.includes(d)) return {reason: 'secret_dir'};
  const base = k.replace(/\/$/, '').split('/').pop();
  if (PROTECTED_FILE.test(base)) return {reason: 'secret_file'};
  if (PROTECTED_EXT.test(base)) return {reason: 'secret_ext'};
  if (!isDirKey(k) && SECRET_NAME.test(base) && !SOURCE_EXT.test(base)) return {reason: 'secret_name'};
  return null;
}

/**
 * N-02 matrix. op: navigate | open_window | list | read | preview | copy | send | modify | delete.
 * Returns {level, redact?} — redact:true means captures/UIA of that window must hide names, thumbnails, preview.
 * «Opening a folder is not reading its files»: navigate/open_window are level 1 but always redacted.
 */
export function resourceDecision(op, p, ownerRoots = []) {
  const OPS = ['navigate', 'open_window', 'list', 'read', 'preview', 'copy', 'send', 'modify', 'delete'];
  if (!OPS.includes(op)) return {level: 'handoff', reason: 'unknown_op'};
  const prot = isProtectedPath(p, ownerRoots);
  if (!prot) return {level: 1, protected: false}; // ordinary files; delete = recoverable .nexus-trash (files.mjs)
  if (op === 'navigate' || op === 'open_window') return {level: 1, protected: true, redact: true, reason: prot.reason};
  return {level: 2, protected: true, redact: true, reason: prot.reason, singleUse: !['read', 'list', 'preview'].includes(op)};
}

// ── Secret filter for every outgoing text (tool results, terminal output, logs, telemetry) ───────────────────────
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-(proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g, /\bAKIA[0-9A-Z]{16}\b/g, /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /((?:api[_-]?key|token|secret|passw(?:or)?d|pwd|passphrase|пароль|client[_-]?secret|auth)\s*["']?\s*[:=]\s*["']?)([^\s"',;]{4,})/gi,
];
/** redactSecrets(text) → {text, redacted:n}. Conservative: false positives are acceptable, leaks are not. */
export function redactSecrets(text) {
  let s = String(text ?? ''), n = 0;
  for (const re of SECRET_PATTERNS) s = s.replace(re, (m, g1, g2) => {
    n++;
    return typeof g2 === 'string' && typeof g1 === 'string' && re.source.startsWith('((?:api') ? g1 + '«redacted»' : '«redacted»';
  });
  return {text: s, redacted: n};
}

// ── IDE policy (owner decision 02.11.2026) ───────────────────────────────────────────────────────────────────────
/** Keys that run code from an IDE without typing a command → arbitrary_command (level 3 / Handoff). */
export const IDE_EXEC_KEYS = Object.freeze(new Set(['f5', 'ctrl+f5', 'shift+f5', 'ctrl+shift+f5', 'ctrl+shift+b', 'ctrl+shift+p', 'f1',
  'ctrl+`', 'ctrl+shift+`', 'ctrl+shift+c', 'ctrl+shift+y', 'ctrl+shift+x', 'ctrl+alt+n', 'ctrl+k ctrl+t']));
/** Focused contexts where typed text becomes a command. UNVERIFIED on real VS Code: names come from xterm/quick-input aria labels. */
const IDE_COMMAND_CTX = /(terminal|терминал|command palette|палитр|run the command|type the name of a command|debug console|консоль отладки|select the task|выберите задачу|run task|запустить задачу|extensions?:|расширени)/i;
/** Positively identified editor surface (Monaco). UNVERIFIED: Monaco's textarea is an Edit whose name starts with the file / «Editor content». */
const IDE_EDITOR_CTX = /(editor content|содержимое редактора|the editor is not accessible|редактор недоступен)/i;

/**
 * classifyIdeInput({keys?, text?, elem:{controlType,name,value}}) → {level, reason}.
 * Fail-closed: Enter / multi-line text is autonomous only in a positively identified editor; anything run-like → 3.
 */
export function classifyIdeInput({keys, text, elem} = {}) {
  const k = keys ? String(keys).toLowerCase() : null;
  if (k && IDE_EXEC_KEYS.has(k)) return {level: 3, reason: 'arbitrary_command', via: 'exec_key:' + k};
  const name = `${elem?.name ?? ''}`;
  const value = `${elem?.value ?? ''}`;
  if (IDE_COMMAND_CTX.test(name)) return {level: 3, reason: 'arbitrary_command', via: 'command_context'};
  if ((elem?.controlType === 'Edit' && /^>/.test(value)) || (typeof text === 'string' && /^>/.test(text) && !IDE_EDITOR_CTX.test(name)))
    return {level: 3, reason: 'arbitrary_command', via: 'quick_open_command_prefix'};
  // Enter on a file-tree / list row opens a file — unless the row looks like a command («Tasks: Run Task»).
  if (k === 'enter' && ['TreeItem', 'ListItem'].includes(elem?.controlType) && !/^[^:]{1,40}:\s/.test(name)) return {level: 1};
  const submits = k === 'enter' || (typeof text === 'string' && /[\r\n]/.test(text));
  if (submits && !IDE_EDITOR_CTX.test(name)) return {level: 3, reason: 'arbitrary_command', via: 'submit_outside_editor'};
  return {level: 1};
}

/** Files that the toolchain EXECUTES: writing them = writing code that an «approved» command will run. */
const EXECUTOR_FILE = /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|\.npmrc|\.yarnrc(\.yml)?|makefile|gnumakefile|justfile|taskfile\.ya?ml|pyproject\.toml|setup\.py|setup\.cfg|tox\.ini|noxfile\.py|conftest\.py|pytest\.ini|requirements[^/]*\.txt|cargo\.toml|build\.rs|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradlew(\.bat)?|pom\.xml|global\.json|directory\.build\.(props|targets)|\.envrc|\.gitattributes|\.gitmodules|\.pre-commit-config\.yaml|\.husky\/[^/]+)$/i;
const EXECUTOR_DIR = /(^|\/)(\.git\/hooks\/|\.git\/config$|\.githooks\/|\.vscode\/(tasks|launch|settings|extensions)\.json$|\.cursor\/|\.github\/workflows\/|\.devcontainer\/)/i;
const EXECUTOR_EXT = /\.(ps1|psm1|psd1|cmd|bat|vbs|sh|bash|exe|dll|msi|lnk|reg|sln|csproj|vcxproj|props|targets)$/i;
export function isExecutorFile(rel) {
  const k = String(rel ?? '').replace(/\\/g, '/');
  return EXECUTOR_FILE.test(k) || EXECUTOR_DIR.test(k) || EXECUTOR_EXT.test(k);
}

/** Hash snapshot of executor files: {relPath: sha256}. `files` = [{path, content}] read by the caller. */
export function executorSnapshot(files) {
  const snap = {};
  for (const f of files) if (isExecutorFile(f.path)) snap[f.path.replace(/\\/g, '/')] = crypto.createHash('sha256').update(f.content ?? '').digest('hex');
  return snap;
}

/**
 * Approved catalogue command: autonomous only if NO executor file changed (added/removed/modified) since the owner's
 * last consent snapshot. Otherwise → Owner Handoff with the diff list. Note: this does NOT make a local run isolated —
 * the test code itself may have been written by NEXUS (ACCEPTANCE must state it).
 */
export function approvedCommandDecision(consentSnap, currentSnap) {
  if (!consentSnap || typeof consentSnap !== 'object') return {level: 3, reason: 'no_owner_snapshot', changed: null};
  const keys = new Set([...Object.keys(consentSnap), ...Object.keys(currentSnap || {})]);
  const changed = [...keys].filter(k => consentSnap[k] !== currentSnap?.[k]).sort();
  return changed.length ? {level: 3, reason: 'executor_files_changed', changed} : {level: 1, changed: []};
}

/** NEXUS writes into an executor file (file API or typing into its editor tab) → level 3 with diff. */
export function writeDecision(rel, ownerRoots = []) {
  const r = resourceDecision('modify', rel, ownerRoots);
  if (r.level !== 1) return r;
  return isExecutorFile(rel) ? {level: 3, reason: 'executor_file_write', showDiff: true} : {level: 1};
}

// ── N-04: consent records ────────────────────────────────────────────────────────────────────────────────────────
const TTL = {2: 10 * 60_000, 3: 120_000};
/**
 * makeConsent({level, action, object, consequences, purpose?, scope?}) → record. A record covers exactly ONE
 * (action, object) pair; level 3 and level-2 copy/send/modify/delete are single-use. Never a blanket grant.
 */
export function makeConsent({level, action, object, consequences, purpose = null, scope = null, singleUse}, now = Date.now()) {
  if (![2, 3].includes(level)) throw Error('consent_level_invalid');
  for (const [k, v] of Object.entries({action, object, consequences})) if (typeof v !== 'string' || !v.trim()) throw Error('consent_field_missing: ' + k);
  return {id: crypto.randomBytes(8).toString('hex'), level, action, object, consequences, purpose, scope,
    singleUse: level === 3 ? true : (singleUse ?? true), createdAt: now, expiresAt: now + TTL[level], decision: 'pending', used: 0};
}
export function decideConsent(rec, decision, now = Date.now()) {
  if (!['allow', 'deny'].includes(decision)) throw Error('consent_decision_invalid');
  if (rec.decision !== 'pending') throw Error('consent_already_decided');
  if (now > rec.expiresAt) { rec.decision = 'expired'; throw Error('consent_expired'); }
  rec.decision = decision; rec.decidedAt = now;
  return rec;
}
/** Does this record authorize THIS action on THIS object now? Consumes single-use records. */
export function consentCovers(rec, {action, object}, now = Date.now()) {
  if (!rec || rec.decision !== 'allow') return false;
  if (now > rec.expiresAt) return false;
  if (rec.action !== action || rec.object !== object) return false;
  if (rec.singleUse && rec.used > 0) return false;
  rec.used++;
  return true;
}

// ── N-05 / A-02: Notepad cold start ──────────────────────────────────────────────────────────────────────────────
/**
 * Win11 Notepad restores the owner's previous session (incl. unsaved tabs with secrets) on a COLD start.
 * NEXUS does not change that Notepad setting. If no Notepad process runs, a test document is NOT opened in Notepad:
 * caller must use another editor or ask the owner (Handoff). Warm start: capture/UIA of non-NEXUS tabs stays redacted.
 */
export function notepadLaunchDecision({running}) {
  if (running === true) return {level: 1, redactForeignTabs: true};
  if (running === false) return {level: 'handoff', reason: 'notepad_cold_start_session_restore'};
  return {level: 'handoff', reason: 'notepad_state_unknown'};
}

// ── Stage 2: one gate for every GUI target (replaces gui.allowedApp / procs isAllowedApp) ─────────────────────────
/**
 * appGate(caps, proc, {title, mode}) → {allow:true, cls} | {allow:false, error, reason} | {allow:false, consent:2|3, what}.
 *  caps.appAccess 'policy' (default 0.5.2): any app by class, owner may block apps (caps.blockedApps).
 *  caps.appAccess 'allowlist': legacy 0.5.1 behaviour (inputApps, HARD_DENY) — owner's fallback switch.
 *  mode 'read' (window list/UIA tree), 'focus', 'input' (mouse/keyboard), 'close' (process close).
 * Errors keep the 0.5.1 prefix (caller's legacy code) so existing clients keep working.
 */
export function appGate(caps, proc, {title = '', mode = 'input'} = {}) {
  const p = norm(proc);
  if (!p) return {allow: false, error: 'target_unknown'};
  if ((caps?.blockedApps || []).some(a => norm(a) === p)) return {allow: false, error: 'blocked_by_owner'};
  if (caps?.appAccess === 'allowlist') {
    const ok = !isHardDenied(p) && (caps.inputApps || []).some(a => norm(a) === p);
    return ok ? {allow: true, cls: 'allowlisted'} : {allow: false, error: 'not_in_allowlist'};
  }
  const c = classifyApp(p, {title});
  if (c.level === 'handoff') return {allow: false, error: 'owner_handoff_required', reason: c.reason};
  if (c.cls === 'protected') return mode === 'focus' ? {allow: true, cls: c.cls} : {allow: false, consent: 2, what: 'protected_app', cls: c.cls};
  if (c.cls === 'admin' && mode === 'input' && adminPage(p, {title})?.level === 3) return {allow: false, consent: 3, what: 'security_page', cls: c.cls};
  if (c.cls === 'system_tool' && mode === 'input') return {allow: false, consent: 3, what: 'system_tool', cls: c.cls};
  return {allow: true, cls: c.cls};
}

/** Clicking an IDE control that RUNS something (Run, Debug, Run Task, ▶) = arbitrary_command. UNVERIFIED names. */
const IDE_RUN_CLICK = /^(?:▶|run\b|debug\b|start debugging|run without debugging|run (?:python|code|task|test|script|cell)|run all|запуск|запустить|выполнить|отладка|начать отладку|esegui|avvia debug)/i;
export function classifyIdeClick(elem) {
  const t = elem?.controlType, n = String(elem?.name ?? '').trim();
  if (!['Button', 'MenuItem', 'SplitButton', 'Hyperlink', 'ListItem'].includes(t)) return {level: 1};
  return IDE_RUN_CLICK.test(n) ? {level: 3, reason: 'arbitrary_command', via: 'click:' + n.slice(0, 60)} : {level: 1};
}

/** Short line diff for executor-file consent (redacted, bounded). */
export function shortDiff(oldText, newText, max = 40) {
  const a = String(oldText ?? '').split(/\r?\n/), b = String(newText ?? '').split(/\r?\n/);
  const A = new Set(a), B = new Set(b), out = [];
  for (const l of a) if (!B.has(l)) out.push('- ' + l);
  for (const l of b) if (!A.has(l)) out.push('+ ' + l);
  const lines = out.slice(0, max).map(l => redactSecrets(l.slice(0, 300)).text);
  return {lines, truncated: out.length > max, removed: out.filter(l => l[0] === '-').length, added: out.filter(l => l[0] === '+').length};
}

/** Deep-redact secrets in a tool result. Image payloads (data/base64 of images) are never touched. */
export function redactDeep(x, depth = 0, cnt = {n: 0}) {
  if (depth > 12) return x;
  if (typeof x === 'string') { if (x.length > 200_000) return x; const r = redactSecrets(x); cnt.n += r.redacted; return r.text; }
  if (Array.isArray(x)) return x.map(v => redactDeep(v, depth + 1, cnt));
  if (x && typeof x === 'object') {
    if (x.type === 'image' && typeof x.data === 'string') return x;
    const o = {};
    for (const [k, v] of Object.entries(x)) o[k] = k === 'jpeg' || k === 'png' ? v : redactDeep(v, depth + 1, cnt);
    if (depth === 0 && cnt.n && !Array.isArray(x)) o.secretsRedacted = cnt.n;
    return o;
  }
  return x;
}

/** Marker NEXUS puts in place of a secret. Writing it back would destroy the owner's real value. */
export const REDACTED_MARK = '«redacted»';

// ── N-03: which denied targets become an Owner Handoff (instead of a plain refusal) ─────────────────────────────────
/** UAC and logon run on the secure desktop: UIA of the user desktop does NOT see them, so «window gone» proves nothing. */
const SECURE_DESKTOP = new Set(['consent', 'logonui', 'lockapp']);
const CREDENTIAL_UI = new Set(['credentialuibroker']);
const SHELLS = new Set(['cmd', 'powershell', 'pwsh', 'powershell_ise', 'windowsterminal', 'wt', 'conhost', 'openconsole', 'bash', 'wsl', 'wslhost',
  'git-bash', 'mintty', 'ssh', 'putty', 'regedit']);
/**
 * Pure. For a target that appGate refused with owner_handoff_required, return a handoff spec, or null when the target
 * is simply not for NEXUS (system processes, NEXUS's own runtime, shell UI) — then the caller keeps the refusal.
 */
export function handoffSpec(proc, reason, title = '') {
  const p = norm(proc), t = String(title || '').slice(0, 80), w = t ? ` «${t}»` : '';
  if (CREDENTIAL_UI.has(p)) return {reason: 'credential_prompt', what: `Введите учётные данные в окне Windows${w} сами — не сообщайте пароль или код в чат.`,
    where: `${proc}${w}`, check: 'NEXUS проверит, что окно запроса учётных данных закрыто', verify: {kind: 'no_window', process: proc}, pause: {input: true, capture: true}};
  if (SECURE_DESKTOP.has(p)) return {reason: 'uac_or_logon', what: 'Подтвердите или отклоните запрос Windows (UAC/вход) сами.',
    where: 'защищённый рабочий стол Windows', check: 'NEXUS не видит защищённый рабочий стол: результат проверяется по последствию (например, появилось окно запущенной программы)',
    verify: {kind: 'none'}, pause: {input: true, capture: true}};
  if (SHELLS.has(p)) return {reason: 'shell_command', what: `NEXUS не вводит команды в ${proc}${w}. Если согласны, выполните нужную команду сами.`,
    where: `${proc}${w}`, check: 'Результат команды NEXUS проверяет по её последствиям (файлы, окна), не по словам в чате', verify: {kind: 'none'}, pause: {input: true, capture: false}};
  if (p === 'mmc' && reason === 'mmc_snapin_not_allowed') return {reason: 'mmc_snapin', what: `Консоль${w} закрыта для NEXUS. Выполните действие в ней сами.`,
    where: `mmc${w}`, check: 'проверка по последствиям действия', verify: {kind: 'none'}, pause: {input: true, capture: false}};
  return null;
}

// ── R-01 (owner, 02.11.2026 — release blocker): accidental deletion of data inside ordinary apps ───────────────────
/**
 * Deletion/erasure inside ANY app (ordinary, Explorer, IDE…) needs owner consent (level 2, what 'destructive_action').
 *  Click (or Enter/Space on the focused control) on a Button/MenuItem/SplitButton/Hyperlink named:
 *   STRONG words (delete, remove, uninstall, erase, wipe, purge, empty recycle bin, permanently…) → consent always;
 *   WEAK words (clear, reset, очистить, сбросить…) → consent, unless the context shows a form/search field: the
 *   control sits inside an Edit/ComboBox (the «×» of a search box) or its name names a field/filter/search/selection.
 *  Keys: Delete / Shift+Delete with focus in a list/tree/grid (selected items: files, records) → consent;
 *   in a text field/editor they stay free. Ctrl+Shift+Delete (clear browsing data) → consent always.
 *  Confirmation dialogs («Are you sure / permanently / cannot be undone»): affirmative button → consent,
 *   negative/«Save» button → free, a button NEXUS cannot name → refused (fail-closed); Enter on a non-button in such a
 *   dialog (activates the default button) → consent.
 * Limits (documented): only what UI Automation exposes — custom-drawn UIs without UIA names, icon-only buttons without
 * a Name, and actions that delete without any of these words are not recognised.
 */
const ACT_TYPES = new Set(['Button', 'MenuItem', 'SplitButton', 'Hyperlink']);
const DLG_BTN_TYPES = new Set(['Button', 'Pane', 'Custom', 'MenuItem', 'SplitButton', 'Hyperlink']); // TaskDialog buttons are Pane
const SEL_TYPES = new Set(['ListItem', 'TreeItem', 'DataItem', 'List', 'Tree', 'DataGrid', 'Table', 'Row']);
export const DESTRUCT_STRONG_RE = /(\bdelete\b|\bdel\b|\bremove\b|\buninstall|\berase\b|\bwipe\b|\bpurge\b|\bshred|\bdestroy|permanent|empty\s+(the\s+)?(recycle\s+bin|trash|bin)|move\s+to\s+(the\s+)?(recycle\s+bin|trash)|\bformat\s+(disk|drive|volume)|factory\s+reset|удал|стереть|уничтож|деинсталл|безвозвратн|очистить\s+корзину|в\s+корзину$|форматировать|\belimina|\brimuovi|disinstalla|cancella\s+definitiv|svuota\s+(il\s+)?cestino|\bsposta\s+nel\s+cestino)/i;
export const DESTRUCT_WEAK_RE = /(\bclear\b|\breset\b|\bclean\s*(up)?\b|\bdiscard\b|\brevert\b|\brestore\s+defaults|очист|сброс|сбросить|отменить\s+изменения|\bpulisci|\bsvuota|\bripristina|\bcancella\b|\bazzera)/i;
const WEAK_FIELD_CTX_RE = /(search|поиск|find|найти|filter|фильтр|field|поле|input|text\s*box|form|форм|selection|выделени|format(ting)?\b|форматирован|zoom|масштаб|\bcerca\b|campo|filtro|selezione)/i;
export const CONFIRM_TEXT_RE = /(are\s+you\s+sure|permanent|cannot\s+be\s+undone|can['’]?t\s+be\s+undone|irreversib|will\s+be\s+(deleted|removed|lost|erased)|delete\s+(this|these|the|\d)|вы\s+уверены|действительно|безвозвратн|нельзя\s+(будет\s+)?(отменить|восстановить)|будут?\s+(удален|потерян|стерт)|удалить\s+(эт|выбран|\d)|sei\s+sicur|definitivament|in\s+modo\s+permanente|non\s+(può|potrà)\s+essere\s+annullat|verranno?\s+(eliminat|rimoss))/i;
const AFFIRM_RE = /^(yes|yes\s+to\s+all|ok|okay|continue|confirm|proceed|delete|remove|erase|uninstall|empty|clear|reset|discard|да|да\s+для\s+всех|ок|продолжить|подтвердить|удалить|стереть|очистить|сбросить|sì|si|conferma|continua|elimina|rimuovi|svuota|procedi)(?![\p{L}\p{N}])/iu;
// Buttons that keep data: negative answers and «Save» (a save prompt may say «changes will be lost»).
const NEGATE_RE = /^(no|no\s+to\s+all|cancel|close|back|keep|save|don['’]?t\s+delete|нет|отмена|отменить|закрыть|назад|оставить|сохранить|не\s+удалять|annulla|chiudi|indietro|mantieni|salva)(?![\p{L}\p{N}])/iu;

const clean = n => String(n ?? '').replace(/[&_]/g, '').replace(/\s+/g, ' ').trim();
const isConfirmDialog = d => !!d && CONFIRM_TEXT_RE.test([d.title, ...(Array.isArray(d.text) ? d.text : [])].join(' \n '));

function byName(elem, parentType) {
  const n = clean(elem?.name);
  if (!n || n.length > 60) return null;
  if (DESTRUCT_STRONG_RE.test(n)) return {via: n};
  if (DESTRUCT_WEAK_RE.test(n)) {
    if (['Edit', 'ComboBox'].includes(parentType) || WEAK_FIELD_CTX_RE.test(n)) return null; // clearing a field/search/filter
    return {via: n};
  }
  return null;
}

/**
 * Click target → null (free) | {level:2, what:'destructive_action', via} | {refuse:true, reason}.
 * `at` = UIA point result: {elem:{controlType,name,id}, parentType, dialog:{modal,className,title,text[]}}.
 */
export function classifyDestructiveClick(at, action = 'click') {
  if (!['click', 'double_click'].includes(action) || !at?.elem) return null;
  const t = at.elem.controlType, n = clean(at.elem.name);
  // Windows CI 41474838530: on a real MessageBox, UIA FromPoint returned the dialog WINDOW itself for every point of
  // the button row — the button under the cursor was not identifiable. Inside a deletion confirmation, a click whose
  // target is not a recognisable element is therefore refused (fail-closed); only Text/Image (the message) is free.
  if (isConfirmDialog(at.dialog) && !DLG_BTN_TYPES.has(t)) {
    if (['Text', 'Image'].includes(t)) return null;
    return {refuse: true, reason: 'destructive_confirm_target_unidentified'};
  }
  if (isConfirmDialog(at.dialog) && DLG_BTN_TYPES.has(t)) {
    if (n && n.length <= 40 && NEGATE_RE.test(n)) return null;
    if (n && n.length <= 40 && AFFIRM_RE.test(n)) return {level: 2, what: 'destructive_action', via: 'confirm:' + n};
    if (t === 'Button' || !n || n.length <= 40) return {refuse: true, reason: 'destructive_confirm_button_unrecognised'};
    return null; // a long Pane name in a dialog is text, not a button
  }
  if (!ACT_TYPES.has(t)) return null;
  const hit = byName(at.elem, at.parentType);
  return hit ? {level: 2, what: 'destructive_action', via: 'click:' + hit.via} : null;
}

/** Keyboard chord in the focused context ({elem, parentType, dialog}) → same results as classifyDestructiveClick. */
export function classifyDestructiveKeys(keys, ctx) {
  const k = String(keys || '').toLowerCase();
  const el = ctx?.elem || {}, t = el.controlType;
  if (k === 'ctrl+shift+delete' || k === 'shift+ctrl+delete') return {level: 2, what: 'destructive_action', via: 'keys:' + k};
  if ((k === 'delete' || k === 'shift+delete') && (SEL_TYPES.has(t) || SEL_TYPES.has(ctx?.parentType) && !['Edit', 'Document'].includes(t))) {
    return {level: 2, what: 'destructive_action', via: `keys:${k} on selection (${t || '?'})`};
  }
  if (k === 'enter' || k === 'space') {
    if (isConfirmDialog(ctx?.dialog)) {
      if (!DLG_BTN_TYPES.has(t)) return k === 'space' ? null : {level: 2, what: 'destructive_action', via: 'keys:enter in a confirmation dialog (default button)'};
      return classifyDestructiveClick({elem: el, dialog: ctx.dialog}, 'click');
    }
    if (ACT_TYPES.has(t)) { const hit = byName(el, ctx?.parentType); if (hit) return {level: 2, what: 'destructive_action', via: `keys:${k} on «${hit.via}»`}; }
  }
  return null;
}
