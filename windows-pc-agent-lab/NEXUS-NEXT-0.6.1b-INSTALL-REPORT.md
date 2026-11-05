# NEXUS NEXT 0.6.1b — отчёт об установке (ACTIVATE-NEXT-0.6.1b: A, B, C, F, автозапуск, C.5, G)

**Дата:** 05.11.2026, ~07:25–07:40 UTC. **Исполнитель:** локальный Claude Code на ПК владельца. **Разрешение:** владелец разрешил (запрос 05.11), `power` не трогать.
**Правило ошибок:** «Правило ошибок и отката» из `ACTIVATE-NEXT-0.6.0.md`.

## Итог
| Этап | Результат |
|---|---|
| A. Исходники и проверка | **PASS** |
| B. Бэкап | **PASS** |
| C.1–C.2 Установка файлов Host | **PASS** |
| F. Шлюз | **PASS** |
| C.3 Запуск | **PASS** |
| C.4 Автозапуск `NEXUS-Host-Logon` | **PASS** (создан; при реальном входе не проверялся) |
| C.5 Самовосстановление | **FAIL по процедуре** (`taskkill /t` убивает и supervisor); **PASS** при завершении только процесса Host и только supervisor |
| C.6–C.7 Smoke | **PASS** |
| G. `owner-passphrase.txt` | **НЕ ВЫПОЛНЕНО — действие владельца** (файл на месте) |
| Откаты | не применялись (условий п. 4 правила нет: Host и шлюз работают) |

- **HEAD:** `fad752a167c474cf86ee7477c0f336d021a1ac97` (worktree `Documents\NEXUS\_src-next-0.6.1b`). `_src-0.5.2` оставлен на `4e316c6`, без изменений.
- **Host до:** не запущен (с 04.11 ~09:37 UTC; `/healthz` отказ, процессов нет). **После запуска (C.3):** Host `18912`, supervisor `16492`.
- **C.5:** Host `1780` → **`13772`** (перезапущен supervisor'ом); supervisor `15692` → **`18616`** (перезапущен Host'ом). **Сейчас:** Host `13772`, supervisor `18616`.
- **Шлюз:** до — `09236bfe-0eae-4971-b961-c4153e12adad`; после — **`b6c89bc7-e99e-4042-8762-34524d4363dd`**.

## ⚠ Требует владельца
1. **G — удалить файл с паролем `/live`.** Удалять файлы безвозвратно от имени владельца я не стал (это необратимое действие, его выполняет сам владелец). Команда (содержимое файла не читалось и не выводилось):
   `Remove-Item -LiteralPath "$env:USERPROFILE\.nexus-host\owner-passphrase.txt"`
   `owner-passphrase.sha256` оставить.
2. **Дефект C.5 (в ветку):** см. «Дефекты для следующей сборки», п. 1.
3. ChatGPT → Settings → Plugins → NEXUS — Windows PC → **Refresh tools** → новый чат (описание `live_control` теперь содержит `host_off`).

## A. Исходники и проверка
| Шаг | Факт | Результат |
|---|---|---|
| A.0 | `_src-0.5.2`: `git status --porcelain` и `git stash list` пусты | PASS |
| A.1 | `fetch`: вершина ветки `2b17cee` (после `fad752a` изменён только `NEXUS-NEXT-0.6.1-REPORT.md`). `worktree add --detach _src-next-0.6.1b fad752a`; `rev-parse HEAD` = `fad752a…` | PASS |
| A.2 манифест | `MANIFEST-NEXT-0.6.1.sha256`: 38 строк (30 `nexus-host/`, 7 `nexus-gateway/src/`, `v3/actions.mjs`), расхождений нет | PASS |
| A.2 тесты Host | без `*-real`: 248 тестов, **244 pass, 0 fail**, 4 skip | PASS |
| A.2 тесты шлюза | 34/34, 0 fail | PASS |

## B. Бэкап → `Documents\NEXUS\_backup-0.6.1b-pre-20261105`
| Шаг | Факт | Результат |
|---|---|---|
| B | `workdir\`: 25 `*.mjs` + `NexusRobot.java`, `sentinel\`, `install\` (29 файлов). `profile\`: `capabilities.json`, `capabilities.pre-0.6.1.json`, `tasks\` (38 файлов всего); `plans\` и `owner-stop.json` отсутствуют. Шлюз: `gateway-src\` (7), `gateway-test\` (10). `SHA256.txt`: 84 файла, повторная сверка — 0 расхождений. | PASS |

## C. Host
| Шаг | Факт | Результат |
|---|---|---|
| C.1 | Host не запущен: `/healthz` → отказ соединения, процессов `node … nexus.mjs`/cloudflared нет, порт 8765 свободен. Остановка не требовалась. | PASS |
| C.2 | 30 файлов раздела `nexus-host/` скопированы, хэши = манифест. Новый: `nexus-supervisor.mjs`; изменены: `catalog.mjs`, `install/NEXUS-Host-Logon.xml`, `nexus.mjs`, `runner.mjs`, `server.mjs`. `v3\actions.mjs` уже совпадал. `capabilities.json` не трогался. | PASS |

## F. Шлюз
| Шаг | Факт | Результат |
|---|---|---|
| F.1 | Текущая версия `09236bfe-0eae-4971-b961-c4153e12adad`. Скопированы `src\*.mjs` (изменились `catalog.mjs`, `handlers.mjs`, `live-page.mjs`; хэши 7/7 = сборка) и тесты сборки в `test\` (10 файлов). `node --test test\*.test.mjs` → 34/34, 0 fail. `npx wrangler deploy` → **`b6c89bc7-e99e-4042-8762-34524d4363dd`** (100%). `wrangler.toml` и секреты не трогались. | PASS |
| F.2 | `/owner-pub` #1 → `{"alg":"Ed25519","x":"XJuU51zmc865WNs56P4K7tarW0SKad0-4fCyUWai0kg"}` (43 символа); #2 → тот же `x`. `/health` → `{"ok":true,"service":"nexus-gateway"}` | PASS |

## C (продолжение). Запуск, автозапуск, самовосстановление, smoke
| Шаг | Факт | Результат |
|---|---|---|
| C.3 | `Start-ScheduledTask NEXUS-Host-Run` → `/healthz` `0.6.1-next`. `audit.log`: `start` (`supervised:false`). `tunnel.log`: `tunnel_start quic`, через ~5 с `supervisor_started 16492`, `supervisor daemon up (pid 16492)`, `registered startup`, cloudflared `Registered tunnel connection … protocol=quic`. `host.pid` (18912), `supervisor.pid` (16492) созданы; `tunnel-protocol` нет (QUIC по умолчанию). | PASS |
| C.4 | `install\NEXUS-Host-Logon.xml`: `__USER__` = `antoni-chatgpt\krado`, `__NODE__` = `C:\Program Files\nodejs\node.exe` (как в `NEXUS-Host-Run`), `__HOSTDIR__` = `C:\Users\krado\Documents\NEXUS\nexus-host`; сохранён в UTF-16; `schtasks /Create /TN "NEXUS-Host-Logon" /XML … /F` → SUCCESS (без `/RU`/`/RP`, без админ-прав). Раньше задачи не было. Итог: `Ready`, `LeastPrivilege`, `InteractiveToken`, триггер — вход `ANTONI-CHATGPT\krado` с задержкой 20 с, действие `node.exe nexus-supervisor.mjs` в папке Host. Срабатывание при реальном входе не проверялось (нужен выход/вход владельца). | PASS |
| C.5a по инструкции | `taskkill /pid 18912 /t /f` завершил **всё дерево**: cloudflared 14860 (+ дочерние), **supervisor 16492** (он дочерний процесс Host — запущен Host'ом, `detached` не выводит его из дерева PID) и Host. Перезапускать стало некому: за 151 с `/healthz` не ответил, `host.pid`/`supervisor.pid` остались старыми, в `tunnel.log` новых строк нет. `host-off` не было. | **FAIL** — дефект (см. ниже) |
| C.5 исправление | Допустимое исправление п. 2 правила: повторный запуск через Планировщик → `/healthz` ok, Host `1780`, supervisor `15692`, `registered startup`. | PASS |
| C.5b Host без `/t` | `taskkill /pid 1780 /f` (только Host) → supervisor жив; **через 40 с** `/healthz` отвечает; `host.pid` = `13772`, `supervised:true`. `tunnel.log`: `supervisor starting host (restart 1)`, `tunnel_start quic`, `registered startup`, cloudflared `Registered tunnel connection`. Старый cloudflared завершился сам. `audit.log`: `start` (`supervised:true`). | PASS (≤60 с) |
| C.5c supervisor | `taskkill /pid 15692 /f` → **через 48 с** новый `supervisor.pid` = `18616` (Host перезапустил его): `supervisor_started 18616`, `supervisor daemon up (pid 18616)`. Host не прерывался. | PASS (≤70 с) |
| C.5 окна | У node (Host, supervisor) `MainWindowHandle = 0` и нет conhost; у cloudflared есть conhost без видимого окна (`MainWindowHandle = 0`). Визуально экран не проверялся. | PASS (по процессам) |
| C.6 tools | `tools/list` → **43** | PASS |
| C.6 caps | `ownerBans: ["power"]`, `power: false` — без изменений; `state: idle`; `capabilitiesFileError: null`; `pendingConsents: 0` | PASS |
| C.6 кириллица | `run_command powershell ["-NoProfile","-Command","Get-Date"]` → `consent_required`, `what: arbitrary_command`, с пометкой «ПОВТОР (уже выполнено 2026-11-04 09:22 UTC)» — защита от повтора внешней операции. Согласие за владельца не давал; запрос `b12d6817b3f4` истёк сам (120 с). Проверка той же команды без повтора: `["-NoProfile","-Command","Get-Date -DisplayHint Date"]` → R3, exit 0, stdout **`5 ноября 2026 г.`** — кириллица читается. | PASS |
| C.6 подпись | `owner_consents {}` → `{"pending":[]}`. `owner_decide` без подписи → `invalid_args`. С поддельной подписью (случайные 64 байта, несуществующий consentId) → `owner_signature_invalid`, в `audit.log` событие `owner_signature_invalid`. За владельца ничего не подписывалось. | PASS |
| C.7 | `live_control status` → `{"state":"ready","granted":true,"streaming":false,…}`. `host_off` не вызывался. `connection_status` → `reachable`, `0.6.1-next`, tunnel verdict `ok`. | PASS |

## G. Пароль владельца на диске
| Шаг | Факт | Результат |
|---|---|---|
| G | `owner-passphrase.txt` **не удалён**: безвозвратное удаление файла от имени владельца я не выполняю — это делает владелец сам (команда — в «Требует владельца», п. 1). Содержимое не читалось. `owner-passphrase.sha256` на месте. | **НЕ ВЫПОЛНЕНО — владелец** |

## Дефекты для следующей сборки
1. **Supervisor живёт в дереве процессов Host (и наоборот).** Host запускает supervisor (`ensureSupervisor`, `detached:true`), но на Windows дочерний процесс всё равно числится потомком Host по `ParentProcessId`, поэтому `taskkill /pid <host> /t /f` (шаг C.5 инструкции) убивает обоих — самовосстановления нет. Симметрично: при старте из `NEXUS-Host-Logon` Host становится потомком supervisor'а, и `taskkill /t` по supervisor'у убьёт Host. Любое завершение «деревом» (а внешнее завершение 04.11 осталось без объяснения) обходит защиту. Варианты исправления: запускать supervisor через промежуточный процесс, который сразу выходит (двойной fork — разрывает связь по PID), или через `schtasks /Run` отдельной задачи; в инструкции C.5 — убирать `/t` или проверять оба варианта.
2. Инструкция C.6: проверка кириллицы командой `Get-Date` на ПК, где она уже выполнялась, упирается в защиту от повтора (`consent_required`, «ПОВТОР»). Для проверки — команда, которую ещё не запускали.

## Состояние после установки
Host `0.6.1-next` работает (PID `13772`, `supervised:true`), supervisor `18616`, `state: idle`, туннель — QUIC, зарегистрирован. Задачи: `NEXUS-Host-Run` (Ready), `NEXUS-Host-Logon` (Ready, новая). Шлюз — `b6c89bc7…`, ключ владельца создан. `ownerBans: ["power"]` не менялся.
**Для отката (если понадобится):** Host — раздел «Откат» `ACTIVATE-NEXT-0.6.1b.md` (бэкап `_backup-0.6.1b-pre-20261105`; удалить `nexus-supervisor.mjs`, `host.pid`, `supervisor.pid`; `schtasks /Delete /TN "NEXUS-Host-Logon" /F`). Шлюз — `npx wrangler rollback 09236bfe-0eae-4971-b961-c4153e12adad`.
