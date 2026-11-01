# ACTIVATE NEXUS 0.5.0 — одноразовая установка (для локального Claude Code на ПК владельца)

**Выполнять только после отдельной команды владельца «устанавливай 0.5.0».**
Ветка `experiment/nexus-0.5.0-unified-20261101`. Код = коммит из NEXUS-0.5.0-REPORT.md. Файлы и SHA-256 — `MANIFEST-0.5.0.sha256`.
Сейчас на ПК: Host 0.4.2 + hotfix 0.4.3 (consent/gui/server от `37f421a`), шлюз `b62e256b…` (0.4.2).

## Не менять
Smart App Control / Defender / UAC, `main`, чужие Workers, автозапуск Windows. Не включать `live_view`, `browser`, `gui_input`, `process_control` — их включает владелец сам.
Не трогать открытые окна владельца (в т.ч. Блокнот).

## 0. Подготовка
1. `git fetch origin experiment/nexus-0.5.0-unified-20261101` в `Documents\NEXUS\_src-0.4.3` (или новый клон в `_src-0.5.0`), checkout, HEAD = коммит отчёта.
2. `node --test` всех `windows-pc-agent-lab/nexus-host/*.test.mjs`, кроме `*-real*` → все PASS. `nexus-gateway`: `npm test` → PASS.
3. Сверить SHA-256 14 файлов с `MANIFEST-0.5.0.sha256`.

## 1. Резервная копия
Из рабочей папки Host скопировать ВСЕ `.mjs` + `NexusRobot.java` → `_backup-0.4.3-20261101\nexus-host\` (полная копия, не только меняемые).
Из папки шлюза: `src\*.mjs` → `_backup-0.4.3-20261101\nexus-gateway-src\`. Записать SHA-256 бэкапа в `_backup-0.4.3-20261101\SHA256.txt`.
`%USERPROFILE%\.nexus-host\capabilities.json` → копия в бэкап (файл не менять: новые ключи `live_view`/`launchApps` имеют безопасные значения по умолчанию).

## 2. Host smoke (до шлюза)
1. Остановить Host: `DELETE /tunnel` (как в 0.4.2), затем точные PID node и cloudflared из `host_diagnostics`.
2. Скопировать 10 файлов `nexus-host/*` из манифеста в рабочую папку Host (новые: `apps.mjs`, `live.mjs`).
3. Запуск только через Планировщик (как 0.4.2). Ожидание в окне: `NEXUS Host — ACTIVE`, строка capabilities содержит `live_view=off`, `Tunnel registered`.
4. Локально (Bearer из token.txt, значение не выводить): `GET http://127.0.0.1:8765/healthz` → `{"ok":true,"service":"nexus-host","version":"0.5.0"}`;
   `tools/list` → 35; `get_capabilities` → `live_view:false, gui_input:false`; `live_frame` → `{"state":"off"}` (без захвата);
   `connection_status` → `host:"reachable"`; `manage_app_access {action:"request",process:"cmd"}` → `app_hard_denied`;
   `manage_app_access {action:"request",process:"mspaint"}` → `consent_required`, затем `confirm_action … cancel` (ничего не выдавать).
5. Любой FAIL → откат (раздел 5), шлюз НЕ трогать.

## 3. Gateway deploy (только после PASS п.2)
1. Скопировать 4 файла `nexus-gateway/src/*` из манифеста в папку шлюза. `wrangler.toml` не меняется, новых секретов нет.
2. `npx wrangler deploy` → записать Version ID.
3. `GET https://nexus-gateway.entoni441.workers.dev/health` → ok; `GET /live` → страница входа (не вводить пароль — это делает владелец).

## 4. Проверка через настоящий коннектор (владелец)
ChatGPT → Plugins → NEXUS — Windows PC → **Refresh tools** → новый чат. Проверить: версия 0.5.0, видно 34 инструмента (`live_frame` скрыт от модели — это правильно).
Дальше — единая живая приёмка по `NEXUS-0.5.0-ACCEPTANCE.md`.

## 5. Откат
Host: остановить (п.2.1) → вернуть файлы из `_backup-0.4.3-20261101\nexus-host\` (удалить `apps.mjs`, `live.mjs`) → запуск через Планировщик → `host_diagnostics` version 0.4.2.
Шлюз (если деплоился): вернуть `src` из бэкапа → `npx wrangler deploy` (или `npx wrangler rollback b62e256b-3e22-4f73-81ae-f19fe89d69aa`).
`capabilities.json` из бэкапа, если менялся.

## Отчёт
Таблица шаг / факт / PASS-FAIL, HEAD, SHA-256 совпадение, PID node/cloudflared, Version ID шлюза.
