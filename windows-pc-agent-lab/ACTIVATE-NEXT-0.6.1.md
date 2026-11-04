# ACTIVATE — NEXUS NEXT 0.6.1-next (для локального Claude Code на ПК)

**Что это:** модель полномочий владельца (решение 04.11.2026, NX-052-36 / FR-10). Всё доступно по умолчанию; ограничения — только словом владельца (`set_capability false`, `manage_app_access revoke`); подтверждение самого владельца нужно лишь для «списка владельца» — и только на его странице Live View (`/live` → «Подтверждения», пароль владельца), не в чате.
**Список владельца:** оплата/покупки/подписки; отправка/публикация/удаление от его имени; секреты и менеджеры паролей; безвозвратное удаление и закрытие его несохранённых окон/процессов; изменения защиты Windows; снятие запрета, который он поставил.

**Сборка:** ветка `experiment/nexus-0.5.2-owner-access-20261102`, коммит — см. `NEXUS-NEXT-0.6.1-REPORT.md` («Сборка»); файлы и SHA-256 — `MANIFEST-NEXT-0.6.1.sha256`.
**Сейчас на ПК (база отката):** Host 0.6.0-next (`0dbd067`, бэкап `Documents\NEXUS\_backup-0.6.0-pre-20261103`), Gateway `d72ba682-26ed-4559-9375-cdbb43106f9e`.
**Разрешение:** установка Host и деплой шлюза — только после явного решения владельца. Не менять: Smart App Control / Defender / UAC / BitLocker / Firewall, `main`, чужие окна и документы.
**Ошибки и откат:** по «Правилу ошибок и отката» из `ACTIVATE-NEXT-0.6.0.md` (диагностика → допустимое исправление → повтор; аварийный откат только затронутого компонента; STOP, настройки, задачи, чекпоинты сохраняются).

## A. Исходники и проверка (ничего не меняет)
1. `git -C Documents\NEXUS\_src-next-0.6.0 fetch origin experiment/nexus-0.5.2-owner-access-20261102`.
2. `git -C Documents\NEXUS\_src-0.5.2 worktree add --detach Documents\NEXUS\_src-next-0.6.1 <коммит сборки>`; `git rev-parse HEAD` совпадает.
3. Манифест: `Get-Content windows-pc-agent-lab\MANIFEST-NEXT-0.6.1.sha256 | % { $h,$f = $_ -split '  ',2; if ((Get-FileHash $f -Algorithm SHA256).Hash.ToLower() -ne $h) { "FAIL $f" } }` → пусто.
4. Тесты: Host (без `*-real`) → 0 fail; шлюз `node --test test\*.test.mjs` → 0 fail.

## B. Бэкап → `Documents\NEXUS\_backup-0.6.1-pre-<дата>`
Как в 0.6.0 (B): `*.mjs`, `NexusRobot.java`, папки `sentinel\`, `install\` рабочей папки Host; из `%USERPROFILE%\.nexus-host` — `capabilities.json`, `tasks\`, `plans\`, `owner-stop.json` (если есть); `SHA256.txt`.

## C. Установка Host
1. Остановить Host штатно (`DELETE /tunnel`, затем процесс; задачу `NEXUS-Host-Run` не удалять).
2. Скопировать все файлы раздела `nexus-host/` манифеста в рабочую папку Host. `capabilities.json` руками **не трогать**.
3. Запуск через Планировщик. **Первый запуск 0.6.1 сам мигрирует профиль один раз:** выключенные по старым умолчаниям группы (`commands`, `power`, `process_control`, `run_task` и т.п.) включаются, `taskRoots` = папка профиля владельца, `ownerBans` пуст; копия старого файла — `%USERPROFILE%\.nexus-host\capabilities.pre-0.6.1.json`; в `audit.log` событие `capabilities_migrated` со списком изменений. blockedApps, protectedPaths, limits, задачи — сохраняются. Повреждённый файл не мигрируется (Host не стартует → вернуть файл из B).
4. Smoke:
   - `/healthz` → `0.6.1-next`; `tools/list` → 43; `host_diagnostics` без `capabilitiesFileError`.
   - `get_capabilities` → `commands, power, gui_input, browser, process_control, run_task, live_view` = true; `ownerBans: []`; `taskRoots` = папка профиля; `settableFromChat` — 11 ключей.
   - `run_command git --version` → выполнено **без** consent; `run_command powershell ["-NoProfile","-Command","Get-Date"]` → выполнено без consent (R3, автономно).
   - Список владельца (ничего не удаляет): создать `NEXUS-workspace\owner-test.txt` (`write_text`), затем `run_command cmd ["/c","del","owner-test.txt"]` → `consent_required`, `what: destructive_command`, `approval: owner_phone`; `confirm_action allow` → `owner_approval_pending`; файл на месте. Отменить: вызвать на Host напрямую `owner_decide {consentId, decision:"cancel"}` (POST `/mcp` с токеном Host) → `confirm_action` → `cancelled, by: owner`; файл на месте; удалить его через `file_action delete` (в корзину NEXUS).
   - Запрет словом: `set_capability {capability:"power", enabled:false}` → `ownerBan:true`; `power_action lock dryRun` → `capability_disabled`. Снятие: `set_capability power true` → `consent_required what: owner_unban`; `owner_decide allow` (напрямую) → `confirm_action allow` → `enabled:true`, `ownerBans: []`.
   - `open_app explorer` → `finish_task` → окно закрыто; `live_control stop` → `stopped_by_owner` → `resume`.

## F. Шлюз (после PASS C; разрешение владельца)
1. `npx wrangler deployments list` → записать Version ID; бэкап `src\*.mjs`.
2. Скопировать `nexus-gateway/src/*.mjs` из сборки (изменены `catalog.mjs`, `handlers.mjs`, `live-page.mjs`). `wrangler.toml` и секреты не трогать.
3. `node --test test\*.test.mjs` → 0 fail; `npx wrangler deploy`; `/health` ok.
4. `/live` (вход паролем владельца) — над экраном блок «Подтверждения» (пустой, если ничего не ждёт).
5. Владелец: ChatGPT → Settings → Plugins → NEXUS — Windows PC → **Refresh tools** → новый чат.

## Откат
- Host: остановить → программные файлы из B → `capabilities.json`: 0.6.0 не принимает новый ключ `ownerBans` (fail-closed), поэтому текущий файл сохранить рядом как `capabilities.0.6.1.json` и вернуть `capabilities.pre-0.6.1.json` → `capabilities.json` (запреты, поставленные владельцем в 0.6.1, записать в отчёт — в 0.6.0 они не переносятся) → Планировщик → `/healthz` = `0.6.0-next`.
- Шлюз: `npx wrangler rollback <Version ID из F.1>`.

## Отчёт → `windows-pc-agent-lab/NEXUS-NEXT-0.6.1-INSTALL-REPORT.md`
Шаг / факт / PASS-FAIL; HEAD; PID; версия шлюза до/после; вывод `capabilities_migrated` из audit.log (без путей пользователя, если владелец не просил).
