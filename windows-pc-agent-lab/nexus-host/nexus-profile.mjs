#!/usr/bin/env node
/**
 * NEXUS 0.5.1 (D1/D4) — owner's persistent permission profile WITHOUT editing JSON.
 * Runs locally on the owner's PC only (no network, no MCP tool can call it). Writes %USERPROFILE%\.nexus-host\capabilities.json
 * atomically and validated (capstore.edit). A running Host picks the change up within ~2 s, no restart.
 *
 *   node nexus-profile.mjs                 — show the profile
 *   node nexus-profile.mjs autonomous      — browser + mouse/keyboard + Live View during tasks + read UI/screen
 *   node nexus-profile.mjs minimal         — back to safe defaults (all dangerous groups off)
 *   node nexus-profile.mjs on|off <group>  — gui | browser | live | screen | ui | processes | tasks
 *   node nexus-profile.mjs allow-app <Process> [C:\full\path\app.exe]   /   deny-app <Process>
 *   node nexus-profile.mjs chat-grants on|off — may ChatGPT RAISE a grant from chat (lowering is always allowed)
 *
 * Persistent grant ≠ activity: a grant only ALLOWS; screen capture and input happen only inside a running task session,
 * which ends (stream off, own windows closed) at finish/Stop/idle. HARD_DENY (shells, UAC, Settings, password managers…)
 * and the browser payment boundary are not configurable here.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCapStore} from './capstore.mjs';
import {validateCapabilities, APP_NAME, LAUNCH_NAME, launchExeOk, isHardDenied} from './capabilities.mjs';

export const GROUPS = Object.freeze({gui: 'gui_input', browser: 'browser', live: 'live_view', screen: 'screen_capture', ui: 'ui_read',
  processes: 'process_control', tasks: 'run_task'});
export const PRESETS = Object.freeze({
  autonomous: {screen_capture: true, ui_read: true, gui_input: true, browser: true, live_view: true},
  minimal: {gui_input: false, browser: false, live_view: false, process_control: false, run_task: false},
});
const RU = {screen_capture: 'снимок экрана', ui_read: 'чтение интерфейса окон', gui_input: 'мышь и клавиатура', browser: 'браузер NEXUS (отдельный профиль Edge)',
  live_view: 'Live View во время задач', process_control: 'управление процессами', run_task: 'запуск заданных задач', grantsFromChat: 'ChatGPT может сам включать разрешения'};

export function describe(c) {
  const lines = Object.entries(RU).map(([k, t]) => `  ${c[k] ? '[x]' : '[ ]'} ${t}`);
  lines.push(`  Приложения для ввода: ${c.inputApps.join(', ') || '-'}`);
  const L = Object.keys(c.launchApps || {}); if (L.length) lines.push(`  Запускаемые приложения: ${L.join(', ')}`);
  lines.push('  Всегда требуют вашего согласия: платёж/заказ/подписка, отправка и публикация от вашего имени, закрытие ваших окон без просьбы.');
  return lines.join('\n');
}

/** Pure command → mutation of the raw JSON object. Throws a short Russian message on bad input. */
export function commandToMutation(argv) {
  const [cmd, a, b] = argv;
  if (!cmd || cmd === 'status') return null;
  if (PRESETS[cmd]) return raw => Object.assign(raw, PRESETS[cmd]);
  if (cmd === 'on' || cmd === 'off') {
    const key = GROUPS[a]; if (!key) throw Error(`неизвестная группа «${a}». Есть: ${Object.keys(GROUPS).join(', ')}`);
    return raw => { raw[key] = cmd === 'on'; };
  }
  if (cmd === 'chat-grants') { if (!['on', 'off'].includes(a)) throw Error('chat-grants on|off'); return raw => { raw.grantsFromChat = a === 'on'; }; }
  if (cmd === 'allow-app' || cmd === 'deny-app') {
    const proc = String(a || '').replace(/\.exe$/i, '');
    if (!APP_NAME.test(proc)) throw Error('укажите имя процесса, например mspaint');
    if (cmd === 'allow-app' && isHardDenied(proc)) throw Error(`«${proc}» в постоянном запрете (HARD_DENY) и не может быть разрешён`);
    const launch = cmd === 'allow-app' && b ? {name: proc.toLowerCase(), exe: b} : null;
    if (launch && (!LAUNCH_NAME.test(launch.name) || !launchExeOk(b))) throw Error('путь должен быть полным путём к .exe (не скрипт, не системная оболочка)');
    return raw => {
      const list = Array.isArray(raw.inputApps) ? raw.inputApps : ['Notepad', 'CalculatorApp'];
      raw.inputApps = cmd === 'allow-app' ? (list.some(x => x.toLowerCase() === proc.toLowerCase()) ? list : [...list, proc])
        : list.filter(x => x.toLowerCase() !== proc.toLowerCase());
      if (launch) raw.launchApps = {...(raw.launchApps || {}), [launch.name]: launch.exe};
      if (cmd === 'deny-app' && raw.launchApps) delete raw.launchApps[proc.toLowerCase()];
    };
  }
  throw Error(`неизвестная команда «${cmd}»`);
}

export function runProfile(argv, {home = process.env.NEXUS_HOME || path.join(os.homedir(), '.nexus-host'), out = console.log} = {}) {
  const file = path.join(home, 'capabilities.json');
  if (!fs.existsSync(file)) throw Error(`нет ${file} — сначала один раз запустите NEXUS Host`);
  const initial = validateCapabilities(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
  const store = createCapStore({file, initial});
  const mutate = commandToMutation(argv);
  let changes = {};
  if (mutate) changes = store.edit(mutate, 'owner_profile_cli');
  out(`Профиль NEXUS (${file}):\n${describe(store.get())}`);
  if (mutate) out(Object.keys(changes).length ? `Изменено: ${Object.keys(changes).join(', ')}. Host применит за ~2 с, перезапуск не нужен.` : 'Без изменений.');
  return {caps: store.get(), changes};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runProfile(process.argv.slice(2)); } catch (e) { console.error('Ошибка: ' + e.message); process.exit(2); }
}
