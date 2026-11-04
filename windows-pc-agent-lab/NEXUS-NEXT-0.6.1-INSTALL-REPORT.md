# NEXUS NEXT 0.6.1-next — отчёт об установке (ACTIVATE-NEXT-0.6.1: A, B, C, F)

**Дата:** 04.11.2026, ~10:15–10:30 (UTC+1). **Исполнитель:** локальный Claude Code на ПК владельца. **Разрешение:** владелец разрешил установку (запрос 04.11).
**Правило ошибок:** «Правило ошибок и отката» из `ACTIVATE-NEXT-0.6.0.md` и раздел «Ошибки во время приёмки» в `NEXUS-NEXT-ACCEPTANCE.md`.

## Итог
| Этап | Результат |
|---|---|
| A. Исходники и проверка | **PASS** (после диагностики: тест требовал `rm` в PATH) |
| B. Бэкап | **PASS** |
| C. Установка Host | **PASS по основным пунктам**; 2 FAIL (дефекты кода, нужна сборка), 2 BLOCKED (нужен владелец) |
| F. Шлюз | **PASS** (F.1–F.3); F.4 и F.5 — действия владельца |
| Откаты | не применялись (условий п. 4 правила нет: Host и шлюз работают) |

- **HEAD:** `a6457b63a588df69ffc33c24e3a92ac49a3c8865` (worktree `Documents\NEXUS\_src-next-0.6.1`).
- **PID Host:** до — `1472` (0.6.0-next); после — **`23240`** (0.6.1-next).
- **Шлюз:** до — `d72ba682-26ed-4559-9375-cdbb43106f9e`; после — **`09236bfe-0eae-4971-b961-c4153e12adad`**.

## ⚠ Требует владельца
1. **`power` сейчас выключен запретом владельца** (`ownerBans:["power"]`). Запрет поставлен smoke-шагом «Запрет словом». Снять его может только владелец, поэтому снятие (`owner_unban`) я за владельца не одобрял. Запрос на снятие ждал на `/live` 10 минут (consent `b6d46cd6c83f`). Чтобы вернуть `power`: в чате — `set_capability power true`, затем подтвердить на `/live` → «Подтверждения».
2. **Ввод в Блокнот без буфера не проверен:** Блокнот не был запущен, а NEXUS его с нуля не открывает (восстановятся прошлые вкладки владельца). Откройте Блокнот сами и повторите шаг; если проверять будет ChatGPT — через приёмку.
3. **F.4:** войти на `/live` паролем владельца и убедиться, что над экраном есть блок «Подтверждения».
4. **F.5:** ChatGPT → Settings → Plugins → NEXUS — Windows PC → **Refresh tools** → новый чат.

## A. Исходники и проверка
| Шаг | Факт | Результат |
|---|---|---|
| A.1 | `fetch` ветки: вершина `8ce0b8e` (после `a6457b6` изменён только `NEXUS-NEXT-0.6.1-REPORT.md`). В `_src-0.5.2` и `_src-next-0.6.0` нет несохранённых изменений, `git stash list` пуст. | PASS |
| A.2 | `worktree add --detach _src-next-0.6.1 a6457b6`; `rev-parse HEAD` = `a6457b6…` | PASS |
| A.3 | `MANIFEST-NEXT-0.6.1.sha256`: 37 строк, расхождений нет | PASS |
| A.4 Host | **Исходно:** 244 теста, 239 pass, **1 fail**, 4 skip. Упал `next-b3.test.mjs:48` («run_command: real spawn …»): ожидался `consent_required`, получено `undefined`. **Диагностика:** тест удаляет файл Unix-командой `rm`, а в PATH окружения PowerShell, из которого запускались тесты, нет `C:\Program Files\Git\usr\bin` (`Get-Command rm.exe` → False), поэтому команда не нашлась ещё до классификации. Это ограничение тестовой среды, а не дефект сборки (в CI на Windows `rm` в PATH есть). **Повтор** в окружении с Git `usr\bin` в PATH: тест отдельно — 1/1; весь набор — 244 теста, **240 pass, 0 fail**, 4 skip. Код не менялся. Рекомендация для ветки: в тесте брать `cmd /c del` на win32. | PASS (после диагностики) |
| A.4 шлюз | 34/34, 0 fail | PASS |

## B. Бэкап → `Documents\NEXUS\_backup-0.6.1-pre-20261104`
| Шаг | Факт | Результат |
|---|---|---|
| B | `workdir\`: 25 `*.mjs` + `NexusRobot.java`, `sentinel\` (1), `install\` (2); `tasks\`/`plans\` в рабочей папке нет. `profile\`: `capabilities.json` (0.6.0) и `tasks\` (34 файла); `plans\` нет; `owner-stop.json` не было. `SHA256.txt`: 64 файла, повторная сверка — 0 расхождений. В F добавлены `gateway-src\` (7) и `gateway-test\` с хэшами в том же `SHA256.txt`. | PASS |

## C. Установка Host
| Шаг | Факт | Результат |
|---|---|---|
| C.1 | Host 0.6.0 (PID 1472) остановлен штатно: `DELETE /tunnel` → `{"ok":true,"removed":true}`, затем node и его дочерние cloudflared/java/conhost; порт 8765 освобождён. Задача `NEXUS-Host-Run` не удалялась. | PASS |
| C.2 | 29 файлов раздела `nexus-host/` скопированы, хэши совпадают с манифестом. `v3\actions.mjs` уже совпадал (`4e12abfe…`). `capabilities.json` руками не трогался. | PASS |
| C.3 запуск | Планировщик → `/healthz` `0.6.1-next`, PID 23240. Миграция выполнена: создан `capabilities.pre-0.6.1.json`, в `capabilities.json` `_profile:2`. | PASS |
| C.3 audit | **FAIL — дефект кода.** События `capabilities_migrated` в `audit.log` нет (нет даже `start`). Причина: событие пишется только в ветке `if (process.argv[1] === server.mjs)` (`server.mjs:503–505`), а Планировщик запускает `nexus.mjs`, который импортирует `server.mjs`, — эта ветка не выполняется. Сама миграция корректна, данные сохранены в `capabilities.pre-0.6.1.json`. Исправить на ПК нельзя (правка кода запрещена). Исправление — в ветке: писать событие из `nexus.mjs` после `createServer`. На работу Host не влияет, отката не требует. | FAIL — нужна сборка |
| C.4 health/tools | `version 0.6.1-next`; `tools/list` → **43**; `host_diagnostics` → `capabilitiesFileError:null`, туннель зарегистрирован (`09:21:50Z`), `cloudflaredAlive:true` | PASS |
| C.4 caps | `commands, power, gui_input, browser, process_control, run_task, live_view` = true; `ownerBans: []`; `taskRoots` = папка профиля; `settableFromChat` — 11 ключей | PASS |
| C.4 команды | `git --version` → R0, exit 0, без consent. `powershell -NoProfile -Command Get-Date` → R3, exit 0, без consent. **Замечание (FAIL, некритично):** вывод Windows PowerShell с кириллицей пришёл искажённым (`4 ����� 2026 г.`) — stdout декодируется не в той кодовой странице (OEM/ANSI vs UTF-8). Исправление — в ветке. | PASS / замечание |
| C.4 список владельца | `write_text owner-test.txt` → создан. `run_command cmd /c del owner-test.txt` → `consent_required`, `what: destructive_command`, `approval: owner_phone`. `confirm_action allow` → `owner_approval_pending`; файл на месте. `owner_decide cancel` (напрямую на Host) → `confirm_action` → `cancelled:true, by:"owner"`; файл на месте. `file_action delete` → `.nexus-trash/…-owner-test.txt`, `recoverable:true`. *(Первая попытка: я вызвал `write_text` без обязательного `expectedSha256` — моя ошибка в аргументах. Повисшее согласие `e5b695f66c15` отменено через `owner_decide cancel`, шаг повторён целиком.)* | PASS |
| C.4 запрет словом | `set_capability power false` → `ownerBan:true, persistent:true`; `power_action lock dryRun` → `capability_disabled`; `set_capability power true` → `consent_required`, `what: owner_unban`, `approval: owner_phone`. **Одобрить снятие запрета за владельца мне не разрешено** (одобрение `owner_unban` от имени владельца заблокировано политикой безопасности) — и по смыслу модели полномочий снимать запрет может только владелец. | запрет — PASS; снятие — **BLOCKED (нужен владелец)** |
| C.4 ввод без буфера | Подпись буфера владельца до шага записана (только хэш, содержимое не читалось в отчёт: 7 форматов). `open_app notepad` → `owner_action_required`, `reason: notepad_cold_start_session_restore` (NEXUS не запускает Блокнот с нуля). Открыть Блокнот за владельца запрещено правилами установки. Handoff отменён (`task_cancel`), `finish_task`. Буфер не затронут (ввода не было). | **BLOCKED (нужен владелец)** |
| C.4 загрузка | `browser_open https://www.7-zip.org/download.html` → клик по официальной ссылке `7z2605-x64.exe` (e17, GitHub-релиз ip7z/7zip) → в ответе `downloads` (`id 324be3ac`). `browser_tabs downloads` → `state: completed`, 1 663 506 байт, `sha256 fd99e86f…71647d0`, `states: download_completed, mark_of_the_web_set, signature_absent`. Файл — `NEXUS-workspace\downloads\7z2605-x64.exe`, `.incoming` пуст. Независимо: `Get-FileHash` совпадает; `Zone.Identifier`: `ZoneId=3`, `HostUrl=https://release-assets.githubusercontent.com/`; `Get-AuthenticodeSignature` → `NotSigned` (установщик 7-Zip не подписан — факт о файле, не дефект). Установщик не запускался. | PASS |
| C.4 explorer | `open_app explorer` → `createdByNexus` = «Главная — проводник»; `finish_task` → окно закрыто, браузер NEXUS закрыт (`cdp_browser_close`), `taskStatus: finished` | PASS |
| C.4 STOP | `live_control stop` → `stopped:true`; `open_app` → `stopped_by_owner`; `resume` → `stopCleared:true`; `owner-stop.json` нет; `state: idle` | PASS |

### Миграция профиля (`capabilities.pre-0.6.1.json` → `capabilities.json`)
Событие в audit.log отсутствует (см. C.3 audit), поэтому список изменений восстановлен сравнением файлов:
- `process_control`: false → **true**; `run_task`: false → **true**
- добавлены: `commands: true`, `power: true`, `taskRoots: ["~"]` (папка профиля), `ownerBans: []`, `_profile: 2`
- без изменений: `screen_capture`, `ui_read`, `gui_input`, `browser`, `live_view` (true), `inputApps` (Notepad, CalculatorApp, msedge), `tasks: {}`, `javaPath`/`edgePath` (null)
- после smoke: `ownerBans: ["power"]`, `power: false` (см. «Требует владельца», п. 1)

## F. Шлюз
| Шаг | Факт | Результат |
|---|---|---|
| F.1 | `wrangler deployments list` → текущая `d72ba682-26ed-4559-9375-cdbb43106f9e`. Бэкап `src\*.mjs` и `test\*.mjs` → `_backup-0.6.1-pre-20261104\gateway-src`, `gateway-test`. | PASS |
| F.2 | Скопированы `src\*.mjs` сборки; по факту изменились `catalog.mjs`, `handlers.mjs`, `live-page.mjs`; хэши 7/7 = манифест. Тесты сборки положены в `test\` (иначе проверяются старые). `wrangler.toml` и секреты не трогались. | PASS |
| F.3 | Тесты 34/34, 0 fail. `npx wrangler deploy` → **`09236bfe-0eae-4971-b961-c4153e12adad`**; `/health` → `{"ok":true,"service":"nexus-gateway"}`. Без входа: `/mcp` → 401, `/live` → 200 (страница входа), `/live/consents` → 401 (маршрут есть, требует сессии владельца). | PASS |
| F.4 | Блок «Подтверждения» показывается только после входа паролем владельца; вводить пароль владельца я не могу. В коде `live-page.mjs` блок и опрос `/live/consents` присутствуют. | **NOT TESTED — действие владельца** |
| F.5 | ChatGPT → Refresh tools → новый чат | действие владельца |

## Дефекты для следующей сборки
1. `capabilities_migrated` (и `start`) не пишутся в audit.log при запуске через `nexus.mjs` (`server.mjs:503–505`).
2. stdout Windows PowerShell с кириллицей декодируется неверно (`run_command`).
3. Тест `next-b3.test.mjs:48` зависит от `rm` в PATH; на Windows без Git `usr\bin` падает.

## Состояние после установки
Host 0.6.1-next работает (PID 23240), `state: idle`, STOP снят, окон и браузера NEXUS нет. В `host_diagnostics` `pendingConsents: 2` — это отменённое `e5b695f66c15` и снятие запрета `b6d46cd6c83f`; оба одноразовые, срок 10 минут. Шлюз — `09236bfe…`. Скачанный тестовый `7z2605-x64.exe` лежит в `NEXUS-workspace\downloads` (можно удалить или оставить для P1-7).
**Для отката (если понадобится):** Host — по разделу «Откат» в ACTIVATE-NEXT-0.6.1 (бэкап B, `capabilities.pre-0.6.1.json`; запрет `power`, поставленный в 0.6.1, в 0.6.0 не переносится); шлюз — `npx wrangler rollback d72ba682-26ed-4559-9375-cdbb43106f9e`.
