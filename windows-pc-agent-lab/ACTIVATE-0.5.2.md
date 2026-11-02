# ACTIVATE NEXUS 0.5.2 — установка 0.5.1-b → 0.5.2 (для локального Claude Code на ПК владельца)

**Выполнять только после отдельной команды владельца «устанавливай 0.5.2» (этап 6).**
Ветка `experiment/nexus-0.5.2-owner-access-20261102`, HEAD = коммит из чекпоинта. Файлы и SHA-256 — `MANIFEST-0.5.2.sha256`.
Сейчас на ПК: Host 0.5.1-b (`92b848f`), профиль `autonomous`; шлюз — 0.5.1-b.

## Что меняется для владельца
- **Любое установленное приложение** (по ярлыку меню «Пуск») открывается без отдельного разрешения: `capabilities.json` без поля `appAccess` = `policy`. Защищённые/системные (Bitwarden, Диспетчер задач, Параметры безопасности…) — с согласием. Откат к поведению 0.5.1: вручную `"appAccess": "allowlist"` в `%USERPROFILE%\.nexus-host\capabilities.json` (Host перечитывает за ~2 с; `nexus-profile.mjs` этот ключ не меняет).
- **Блокнот:** если он не запущен, NEXUS не стартует его сам (Блокнот восстановил бы ваши вкладки) → просит открыть его вручную (Owner Handoff), захват экрана на паузе.
- **Удаление (R-01)**, **защищённые файлы (N-02)**, **произвольные команды в VS Code/Cursor** — через согласие.
- Новые файлы Host: `policy.mjs`, `handoff.mjs`, `discover.mjs`; новая папка `%USERPROFILE%\.nexus-host\tasks\` (чекпоинты задач, без секретов).
- Каталог инструментов: 37, как раньше; изменены только описание `open_app` и номер версии.

## Не менять
Smart App Control / Defender / UAC, `main`, чужие Workers, автозапуск Windows, `wrangler.toml`, секреты шлюза, профиль `autonomous`.
Не трогать открытые окна владельца. Не запускать Блокнот с нуля.

## 0. Подготовка
1. `Documents\NEXUS\_src-0.5.2`: клон ветки (или `git fetch` + checkout), HEAD = коммит чекпоинта.
2. Тесты: все `windows-pc-agent-lab/nexus-host/*.test.mjs`, кроме `*-real*`, `browser.test.mjs`, `egress-proxy.test.mjs` → PASS; затем `node --test --test-force-exit egress-proxy.test.mjs browser.test.mjs` → PASS. `nexus-gateway`: `npm install` + `node --test test/*.test.mjs` → PASS.
3. SHA-256 всех файлов из `MANIFEST-0.5.2.sha256` (`Get-FileHash -Algorithm SHA256`, без учёта регистра) → все совпадают.

## 1. Резервная копия 0.5.1-b → `_backup-0.5.1b-<дата>`
Все `.mjs` + `NexusRobot.java` рабочей папки Host → `nexus-host\`; `src\*.mjs` шлюза → `nexus-gateway-src\`; `capabilities.json` → корень бэкапа; SHA-256 бэкапа → `SHA256.txt`.

## 2. Host (без шлюза)
1. Остановить Host: `DELETE /tunnel`, затем точные PID node и cloudflared из `host_diagnostics`.
2. Скопировать все `nexus-host/*` из манифеста в рабочую папку Host (новые: `policy.mjs`, `handoff.mjs`, `discover.mjs`).
3. Запуск только через Планировщик (разовая задача `NEXUS-Host-Run`, как в `RESTART-HOST.md`). **Задачу не удалять, пока не пройден весь smoke п.4** (установка 02.11: Host исчез без следа примерно через 8 с после удаления задачи; связь не доказана, но риск не нужен). После 0.5.2 любой выход Host, который видит Node, пишется в `tunnel.log` (`host_exit`, `uncaught_exception` со стеком); отсутствие `host_exit` после последнего события = процесс завершён извне.
   В окне: `NEXUS Host — ACTIVE on 127.0.0.1:<port>` (номер версии в окне не печатается, версию подтверждает `healthz`), `Tunnel registered`.
4. Локальный smoke (Bearer из token.txt, значение не выводить):
   - `GET /healthz` → `version:"0.5.2"`; `tools/list` → 37;
   - `get_capabilities` → `appAccess:"policy"`, `session.active:false`, профиль прежний (`gui`, `browser`, `live_view` как до установки);
   - `manage_app_access {action:"list"}` → непустой список приложений из «Пуск»;
   - `inspect_ui` на окне Проводника (тестовая папка) → дерево, не `uia_failed` (исправление после установки 02.11);
   - `live_frame` без активной сессии, кадр не захвачен: при `live_view:true` → `{"state":"ready"}`, при `live_view:false` → `{"state":"off"}`; `finish_task` без сессии → `ended:false`.
5. Любой FAIL → откат (раздел 5), шлюз НЕ трогать.

## 3. Шлюз (только после PASS п.2 и отдельного «да» владельца)
Без деплоя Host 0.5.2 работает полностью; ChatGPT лишь видит старое описание `open_app` и версию 0.5.1 в serverInfo.
1. Скопировать `nexus-gateway/src/catalog.mjs` и `widget.mjs` (остальные файлы `src` не менялись — сверить по манифесту).
2. `npx wrangler deploy` → записать Version ID. 3. `GET https://nexus-gateway.entoni441.workers.dev/health` → ok.

## 4. ChatGPT (владелец)
Settings → Plugins → NEXUS — Windows PC → **Refresh tools** → новый чат. Затем приёмка — `NEXUS-0.5.2-ACCEPTANCE.md`.

## 5. Откат
Host: остановить (2.1) → файлы из бэкапа, удалить `policy.mjs`, `handoff.mjs`, `discover.mjs` → Планировщик → `healthz` version 0.5.1.
**`capabilities.json` — НЕ копировать из бэкапа целиком** (потеряются настройки, изменённые под 0.5.2). 0.5.1-b отвергает неизвестные ключи (`invalid_capabilities: unknown key`), поэтому до запуска 0.5.1-b удалить из текущего файла только ключи `appAccess`, `protectedPaths`, `blockedApps`; остальное (профиль, `inputApps`, `launchApps`, `tasks`) сохраняется. Пример PowerShell:
`$p="$env:USERPROFILE\.nexus-host\capabilities.json"; $j=Get-Content $p -Raw | ConvertFrom-Json; 'appAccess','protectedPaths','blockedApps' | % { $j.PSObject.Properties.Remove($_) }; $j | ConvertTo-Json -Depth 10 | Set-Content $p -Encoding UTF8`
Проверка: `get_capabilities` под 0.5.1-b → `fileError` пустой, профиль как до установки. Бэкап — только если файл повреждён. Приложения, заблокированные под 0.5.2 (`blockedApps`), в 0.5.1-b и так не входят в `inputApps` (revoke удаляет их оттуда). Шлюз: `src` из бэкапа → `npx wrangler deploy` или `npx wrangler rollback <Version ID 0.5.1-b>`.

## Отчёт
Таблица шаг / факт / PASS-FAIL, HEAD, совпадение SHA-256, PID node/cloudflared, Version ID шлюза (если деплоился).
