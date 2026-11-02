# ACTIVATE NEXUS 0.5.1 — одноразовая установка (для локального Claude Code на ПК владельца)

**Выполнять только после отдельной команды владельца «устанавливай 0.5.1».**
Ветка `experiment/nexus-0.5.1-cleanup-stop-20261102`, HEAD = коммит из чекпоинта/отчёта. Файлы и SHA-256 — `MANIFEST-0.5.1.sha256`.
Сейчас на ПК: Host 0.5.0 (Планировщик), шлюз Version `9ccd6986-…` (0.5.0). Бэкап 0.4.3 уже есть: `_backup-0.4.3-20261101`.

## Не менять
Smart App Control / Defender / UAC, `main`, чужие Workers, автозапуск Windows, `capabilities.json` (кроме шага 5 — только по команде владельца).
Не трогать открытые окна владельца (Блокнот с его вкладками и т.д.).

## 0. Подготовка
1. В `Documents\NEXUS` новый клон ветки в `_src-0.5.1` (или `git fetch` + checkout в существующем), HEAD = коммит отчёта.
2. `node --test` всех `windows-pc-agent-lab/nexus-host/*.test.mjs`, кроме `*-real*` (браузерные — с `--test-force-exit`) → PASS. `nexus-gateway`: `npm test` → PASS.
3. Сверить SHA-256 всех файлов с `MANIFEST-0.5.1.sha256` (PowerShell `Get-FileHash -Algorithm SHA256`, сравнение без учёта регистра).

## 1. Резервная копия 0.5.0
Рабочая папка Host: ВСЕ `.mjs` + `NexusRobot.java` → `_backup-0.5.0-20261102\nexus-host\`.
Папка шлюза: `src\*.mjs` → `_backup-0.5.0-20261102\nexus-gateway-src\`.
`%USERPROFILE%\.nexus-host\capabilities.json` → `_backup-0.5.0-20261102\capabilities.json`. SHA-256 бэкапа → `_backup-0.5.0-20261102\SHA256.txt`.

## 2. Host smoke (до шлюза)
1. Остановить Host: `DELETE /tunnel`, затем точные PID node и cloudflared из `host_diagnostics` (как при 0.5.0).
2. Скопировать все файлы `nexus-host/*` из манифеста в рабочую папку Host (новые: `session.mjs`, `nexus-profile.mjs`).
3. Запуск только через Планировщик. В окне: `NEXUS Host — ACTIVE`, `Tunnel registered`.
4. Локально (Bearer из token.txt, значение не выводить):
   - `GET /healthz` → `version:"0.5.1"`; `tools/list` → 37;
   - `get_capabilities` → есть `grants` и `session`, `session.active:false`, `session.liveActive:false`;
   - `finish_task` без сессии → `ended:false`, ничего не закрыто;
   - `live_frame` → `{"state":"off"}` (без захвата);
   - `manage_app_access {action:"request",process:"cmd"}` → `app_hard_denied`;
   - `node nexus-profile.mjs` (без аргументов) → печатает профиль, файл не меняется.
5. Любой FAIL → откат (раздел 6), шлюз НЕ трогать.

## 3. Gateway deploy (только после PASS п.2)
1. Скопировать 4 файла `nexus-gateway/src/*` из манифеста в папку шлюза. `wrangler.toml` и секреты не меняются.
2. `npx wrangler deploy` → записать новый Version ID.
3. `GET https://nexus-gateway.entoni441.workers.dev/health` → ok.

## 4. ChatGPT (владелец)
Settings → Plugins → NEXUS — Windows PC → **Refresh tools** → новый чат. Ожидание: версия 0.5.1, 36 видимых инструментов (`live_frame` скрыт — правильно).

## 5. Профиль автономии (ТОЛЬКО по команде владельца, D4)
В рабочей папке Host: `node nexus-profile.mjs autonomous` — браузер, мышь/клавиатура, Live View во время задач.
Host применяет за ~2 с без перезапуска. Вернуть безопасный: `node nexus-profile.mjs minimal`. Прочее: `on|off gui|browser|live`, `allow-app <Процесс> [путь.exe]`, `deny-app`, `chat-grants on|off`.

## 6. Откат
Host: остановить (п.2.1) → файлы из `_backup-0.5.0-20261102\nexus-host\` (удалить `session.mjs`, `nexus-profile.mjs`) → Планировщик → `healthz` version 0.5.0.
Шлюз: `src` из бэкапа → `npx wrangler deploy` (или `npx wrangler rollback <Version ID 0.5.0>`; полный ID — `npx wrangler deployments list`, начинается на `9ccd6986`).
`capabilities.json` из бэкапа, если менялся.

## Обновление 0.5.1-b (hotfix по живой приёмке)
Те же шаги 1–3; меняются только `nexus-host/browser.mjs`, `gui.mjs`, `uia-script.mjs`, `catalog.mjs` и `nexus-gateway/src/catalog.mjs` (сверить по MANIFEST). Бэкап — `_backup-0.5.1-<дата>`. Профиль (шаг 5) не трогать. После деплоя шлюза — Refresh tools в ChatGPT.

## Отчёт
Таблица шаг / факт / PASS-FAIL, HEAD, совпадение SHA-256, PID node/cloudflared, Version ID шлюза.
Живая приёмка — `NEXUS-0.5.1-ACCEPTANCE.md`.
