# ACTIVATE — NEXUS NEXT 0.6.0-next (для локального Claude Code на ПК)

**Статус:** сборка готова в экспериментальной ветке; **развёртывание не разрешено** до отдельного решения владельца.
Не менять: Smart App Control / Defender / UAC / BitLocker / Firewall, `main`, чужие окна и документы (Блокнот владельца не открывать и не закрывать).

**Сборка:** ветка `experiment/nexus-0.5.2-owner-access-20261102`, коммит — см. `NEXUS-NEXT-RELEASE-REPORT.md` («Сборка»), файлы и SHA-256 — `MANIFEST-NEXT-0.6.0.sha256`.
**База для отката:** Host 0.5.2 `a22fae6` (бэкап `Documents\NEXUS\_backup-0.5.2-74a6f01-20261102`), Gateway Version `27d66b41-29cb-4f69-b763-b543ccfef476` (предыдущая `58806f06-bab1-49d8-ba86-75b94f417ff4`).

Этапы A–C обязательны и самодостаточны. D (автозапуск при входе) и E (Sentinel) — отдельные системные изменения: каждое выполнять **только** если владелец разрешил его явно. При FAIL действовать по разделу «Правило FAIL и отката» (единственный источник правила).

## A. Исходники и проверка (ничего не меняет)
1. `Documents\NEXUS\_src-0.5.2`: `git status --porcelain` и `git stash list` пусты — иначе **стоп**, сохранить diff, отчёт владельцу.
2. `git fetch origin experiment/nexus-0.5.2-owner-access-20261102` → `git checkout --detach <коммит сборки>`; `git rev-parse HEAD` совпадает.
3. Проверка манифеста (PowerShell, без изменения политики выполнения):
   `Get-Content windows-pc-agent-lab\MANIFEST-NEXT-0.6.0.sha256 | % { $h,$f = $_ -split '  ',2; if ((Get-FileHash $f -Algorithm SHA256).Hash.ToLower() -ne $h) { "FAIL $f" } }` → пусто.
4. Тесты: `cd windows-pc-agent-lab\nexus-host; node --test (Get-ChildItem *.test.mjs | ? Name -notlike '*-real*' | % FullName)` → 0 fail. Шлюз: `cd ..\nexus-gateway; node --test test\*.test.mjs` → 0 fail.

## B. Бэкап рабочего Host → `Documents\NEXUS\_backup-0.6.0-pre-<дата>`
Все `*.mjs`, `NexusRobot.java`, `capabilities.json`, папки `tasks\`, `plans\` (если есть) из `%USERPROFILE%\.nexus-host` и рабочей папки Host; `SHA256.txt` по всем файлам бэкапа.

## C. Установка Host (замена файлов, без системных изменений)
1. Остановить Host штатно (как раньше: `DELETE /tunnel`, затем процесс; задачу `NEXUS-Host-Run` не удалять).
2. Скопировать в рабочую папку Host все файлы из манифеста раздела `nexus-host/` (новые: `runner.mjs`, `diag.mjs`, `scoped.mjs`, `power.mjs`, `sentinel\nexus-sentinel.mjs`, `install\*.xml`). `capabilities.json` **не перезаписывать**.
3. `capabilities.json` — новые ключи появятся со значениями по умолчанию сами (`diagnostics:true`, `commands:false`, `power:false`, `lockAfterTask:false`, `taskRoots:[]`, `allowedPackages:[]`, `limits:{}`). Включает их **только владелец** (вне чата).
4. Запуск через Планировщик (`NEXUS-Host-Run`).
5. Smoke (read-only):
   - `/healthz` → `version:"0.6.0-next"`; `tools/list` → **43** инструмента; `host_diagnostics` без `capabilitiesFileError`.
   - `get_capabilities` → есть `state` (`idle`), `grants.commands=false`.
   - `system_info {topic:"os"}`, `{topic:"network"}`, `{topic:"power"}`, `{topic:"autostart_nexus"}` → данные с `collectedAt`; сохранить вывод `power` и `network` в отчёт (сеть: какой адаптер активен — USB Wi-Fi или Ethernet; флаги WoL).
   - `open_app explorer` → окно в `createdByNexus`; `finish_task` → закрыто.
   - `live_control {action:"stop"}` → затем `open_app explorer` → `stopped_by_owner`; **перезапуск Host через Планировщик** → снова `stopped_by_owner` (STOP пережил перезапуск); `live_control {action:"resume"}` → `stopCleared:true`.

## D. Автозапуск Host при входе владельца (только с разрешения владельца)
Цель — после перезагрузки и **входа владельца** Host поднимается сам. Автовход не настраивается.
1. Подставить в `install\NEXUS-Host-Logon.xml`: `__USER__` = `whoami`, `__NODE__` = полный путь `node.exe` (тот же, что в `NEXUS-Host-Run`), `__HOSTDIR__` = рабочая папка Host. Сохранить как UTF-16.
2. `schtasks /Create /TN "NEXUS-Host-Logon" /XML <файл>` (без `/RU`/`/RP` — пароль не нужен и не передаётся).
3. Проверка: `system_info {topic:"autostart_nexus"}` → задача `NEXUS-Host-Logon` с триггером Logon.
4. Откат D: `schtasks /Delete /TN "NEXUS-Host-Logon" /F`.

## E. Sentinel — состояние ПК до входа (только с разрешения владельца; затрагивает шлюз)
1. Шлюз: новый секрет `SENTINEL_TOKEN` (32+ случайных символа; значение не показывать в чате): `npx wrangler secret put SENTINEL_TOKEN`.
2. ПК: `%ProgramData%\NEXUS\sentinel.json` = `{"gatewayUrl":"https://nexus-gateway.entoni441.workers.dev","hostHealthUrl":"http://127.0.0.1:8765/healthz"}`; `%ProgramData%\NEXUS\sentinel-token.txt` = тот же токен; права папки: только SYSTEM и Администраторы.
3. `install\NEXUS-Sentinel.xml`: `__NODE__`, `__SENTINEL__` (полный путь `nexus-sentinel.mjs`) → `schtasks /Create /TN "NEXUS-Sentinel" /XML <файл>` (от администратора — UAC подтверждает владелец).
4. Проверка: `schtasks /Run /TN "NEXUS-Sentinel"` → через ≤60 с `connection_status` показывает `sentinel.state = host_up`.
5. Откат E: `schtasks /Delete /TN "NEXUS-Sentinel" /F`; `npx wrangler secret delete SENTINEL_TOKEN`; удалить `%ProgramData%\NEXUS`.

## F. Шлюз (после PASS A–C; разрешение владельца на деплой)
1. `npx wrangler deployments list` → записать текущий Version ID. Бэкап `src\*.mjs`.
2. Скопировать `nexus-gateway/src/*.mjs` из сборки (`catalog.mjs`, `handlers.mjs` изменены). `wrangler.toml` и секреты не трогать.
3. `node --test test\*.test.mjs` → 0 fail. `npx wrangler deploy` → новый Version ID; `/health` ok.
4. Через шлюз `tools/list` → 43; `connection_status` → прежний вердикт `online`.
5. Владелец: ChatGPT → Settings → Plugins → NEXUS — Windows PC → **Refresh tools** → новый чат.

## Откат
- Host: остановить → вернуть файлы из бэкапа B → удалить `runner.mjs, diag.mjs, scoped.mjs, power.mjs, sentinel\, install\` → удалить `%USERPROFILE%\.nexus-host\owner-stop.json` только если владелец так решил (это его STOP) → Планировщик → `/healthz` = `0.5.2`.
- Шлюз: `npx wrangler rollback <Version ID из F.1>`.
- D/E: см. их пункты отката.

## Правило FAIL и отката (единое)
Принцип: при сбое **во время установки** вернуть последнее подтверждённое рабочее состояние сразу; после установки ничего не откатывать без решения владельца.

| Где FAIL | Действие | Автоматически? |
|---|---|---|
| A (проверка) | Стоп, отчёт. Ничего не менялось. | — |
| B (бэкап) | Стоп, отчёт. Host не тронут. | — |
| C (замена файлов, запуск, smoke) | Откат Host к 0.5.2 по пункту «Host», отчёт. `owner-stop.json` не удалять. | Да — восстановление проверенного состояния |
| D или E | Откат только этого этапа (его пункт отката). Host 0.6.0 остаётся, если C был PASS. Отчёт. | Да — отмена только что внесённого изменения |
| F (деплой шлюза) | `wrangler rollback` к Version ID из F.1, `/health` ok. Host не откатывать. Отчёт. | Да — восстановление записанной версии |
| После завершения установки (физическая приёмка, работа) | Стоп приёмки при FAIL P0, отчёт с фактами. Откат — **только по решению владельца**. | Нет |

Автоматический откат выполняется не более одного раза; если откат сам дал FAIL — стоп, ничего больше не менять, отчёт владельцу.

## Отчёт
Шаг / факт / PASS-FAIL; HEAD; PID Host; версия шлюза до/после; вывод `system_info power`/`network` (без MAC, если владелец не попросил).
