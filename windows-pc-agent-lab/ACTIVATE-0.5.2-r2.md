# ACTIVATE — обновление Host 0.5.2 до a22fae6 (ред. 2) — для локального Claude Code на ПК

Сейчас на ПК: Host 0.5.2 с `74a6f01`. Цель: `a22fae6` (ветка `experiment/nexus-0.5.2-owner-access-20261102`, CI 41510603677: windows + ubuntu + gateway — success).
Шлюз деплоится в п.6 — разрешение владельца получено 02.11 (только после PASS п.0–4). Smart App Control / Defender / UAC не трогать. Блокнот владельца не открывать и не закрывать.

## 0. Исходники без потерь
В `Documents\NEXUS\_src-0.5.2`:
1. `git status --porcelain` и `git stash list`. Если вывод НЕ пуст — **стоп**: ничего не сбрасывать, `git diff > %TEMP%\nexus-src-uncommitted-<время>.diff`, перечислить файлы в отчёте, ждать решения владельца.
2. Только при пустом выводе: `git fetch origin experiment/nexus-0.5.2-owner-access-20261102` → `git checkout --detach a22fae6` (не `reset --hard`). `git rev-parse HEAD` = `a22fae6…`.
3. `sha256sum -c windows-pc-agent-lab/MANIFEST-0.5.2-r2.sha256` (или `Get-FileHash` по тем же строкам) — все OK.

## 1. Тесты
`windows-pc-agent-lab\nexus-host`: `node --test` по всем `*.test.mjs`, кроме `*-real*`. Ожидаемо 0 fail (Linux: 207 pass).

## 2. Бэкап рабочей папки Host → `Documents\NEXUS\_backup-0.5.2-74a6f01-<дата>`
Все `.mjs` + `NexusRobot.java` + `capabilities.json`; SHA-256 → `SHA256.txt`.

## 3. Установка
1. Остановить Host штатно (как в ACTIVATE-0.5.2 п.2.1: `DELETE /tunnel`, затем процесс).
2. Скопировать в рабочую папку Host: `NexusRobot.java, apps.mjs, catalog.mjs, discover.mjs, gui.mjs, live.mjs, server.mjs, session.mjs, lifecycle.mjs` (новый). `capabilities.json` не трогать.
3. Запуск только через Планировщик (`NEXUS-Host-Run`); задачу не удалять до конца smoke.

## 4. Smoke (read-only + один безопасный open_app)
- `healthz` → `version:"0.5.2"`; `tools/list` → прежнее число; `host_diagnostics` без `capabilitiesFileError`.
- `get_capabilities.session` без `ownerPaused`.
- `open_app explorer` → окно открылось, `createdByNexus` содержит его; затем `finish_task` → окно закрыто, `windows.closed` содержит его.
- Read-only: установлен ли VS Code (`where code`, папки `%LOCALAPPDATA%\Programs\Microsoft VS Code`, `C:\Program Files\Microsoft VS Code`).

## 5. Откат (при любом FAIL)
Остановить Host → файлы из бэкапа → удалить `lifecycle.mjs` → Планировщик → `healthz`. Факты и логи (`tunnel.log`) сохранить.

## 6. Шлюз (только после PASS п.0–4)
Зачем: в развёрнутом 0.5.1-b у `live_control` нет `resume` — без деплоя паузу владельца из чата не снять.
1. В папке шлюза на ПК: `npx wrangler deployments list` → записать текущий Version ID (для отката). Бэкап `src\*.mjs` → `_backup-0.5.2-74a6f01-<дата>\nexus-gateway-src\`.
2. Скопировать `nexus-gateway/src/*.mjs` из `a22fae6`. `wrangler.toml` и секреты не трогать. По манифесту 0.5.1 отличаются `catalog.mjs`, `widget.mjs`; остальные сверить SHA с бэкапом и перечислить в отчёте, если отличаются.
3. `npm install` (если нужно) + `node --test test/*.test.mjs` → 30 pass.
4. `npx wrangler deploy` → новый Version ID. `GET https://nexus-gateway.entoni441.workers.dev/health` → ok.
5. Через шлюз (MCP `tools/list` или проверочный вызов, как раньше): описание `live_control` содержит `resume`; `live_control {action:"status"}` → ответ Host.
Откат шлюза: `npx wrangler rollback <Version ID из п.6.1>`.

## 7. Владелец
ChatGPT: Settings → Plugins → NEXUS — Windows PC → **Refresh tools** → новый чат.

## Отчёт
Шаг / факт / PASS-FAIL; HEAD; PID Host; вывод п.0.1 дословно; Version ID шлюза до/после.
