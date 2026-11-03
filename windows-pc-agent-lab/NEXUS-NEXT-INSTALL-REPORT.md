# NEXUS NEXT 0.6.0-next — отчёт об установке (ACTIVATE-NEXT-0.6.0, этапы A–C и F)

**Дата:** 03.11.2026, ~11:50–12:00 (UTC+1). **Исполнитель:** локальный Claude Code на ПК владельца.
**Разрешение владельца:** установка A–C и деплой шлюза F — 03.11.2026 11:46. **D и E не выполнялись** (разрешения нет).
**Инструкции:** `ACTIVATE-NEXT-0.6.0.md` и `NEXUS-NEXT-ACCEPTANCE.md` с вершины ветки `e1da958` (после `0dbd067` менялись только документы). Код — из сборки `0dbd067`.

## Итог
| Компонент | Результат |
|---|---|
| A. Исходники и проверка | **PASS** |
| B. Бэкап Host | **PASS** |
| C. Установка Host | **PASS** |
| F. Шлюз | **PASS** (F.1–F.3); F.4 — PASS по доступным проверкам, вызов через шлюз с OAuth — **NOT TESTED** (нужен ChatGPT); F.5 — действие владельца |
| D, E | не выполнялись |
| Откаты | не применялись |

- **HEAD:** `0dbd06794bffa5bf93cdfaf2bc34506fcc52ad8b` (worktree `Documents\NEXUS\_src-next-0.6.0`).
- **PID Host:** `1472` (после перезапуска в C.5; первый запуск — `3272`). Задача `NEXUS-Host-Run`, `node.exe` = `C:\Program Files\nodejs\node.exe`.
- **Шлюз:** до — `27d66b41-29cb-4f69-b763-b543ccfef476`; после — **`d72ba682-26ed-4559-9375-cdbb43106f9e`**.

## A. Исходники и проверка
| Шаг | Факт | Результат |
|---|---|---|
| A.1 | `_src-0.5.2`: `git status --porcelain` пусто, `git stash list` пусто (HEAD `4e316c6`, detached). Несохранённых изменений владельца нет. | PASS |
| A.2 | `git fetch` (ветка обновилась до `e1da958`); `git worktree add --detach Documents\NEXUS\_src-next-0.6.0 0dbd067`; `rev-parse HEAD` = `0dbd067…` | PASS |
| A.3 | `MANIFEST-NEXT-0.6.0.sha256`: 37 строк, расхождений нет (вывод пустой) | PASS |
| A.4 | Node v24.21.0. Host (без `*-real`): 231 тест, 227 pass, 4 skip, **0 fail**. Шлюз: 31/31, **0 fail** | PASS |

## B. Бэкап → `Documents\NEXUS\_backup-0.6.0-pre-20261103`
| Шаг | Факт | Результат |
|---|---|---|
| B | `workdir\`: 21 `*.mjs` + `NexusRobot.java` из `Documents\NEXUS\nexus-host` (папок `tasks\`/`plans\` там нет). `profile\`: `capabilities.json` и `tasks\` (27 файлов) из `%USERPROFILE%\.nexus-host`; `*.mjs` и `plans\` там нет. `SHA256.txt` по 50 файлам, повторная сверка — 0 расхождений. В F туда же добавлены `gateway-src\` (7 файлов + SHA256.txt) и `gateway-test\` (старые тесты шлюза). | PASS |

## C. Установка Host
| Шаг | Факт | Результат |
|---|---|---|
| C.1 | **Host до установки уже не работал:** порт 8765 закрыт, процесса `nexus.mjs` нет; `NEXUS-Host-Run` в состоянии Ready, LastRunTime 02.11 21:01, LastTaskResult `0xC000013A` (процесс прерван); последняя запись `tunnel.log` — 07:51Z. Останавливать было нечего, `DELETE /tunnel` не нужен. Причина остановки возникла **до** установки, к NEXT не относится. | PASS (n/a) |
| C.2 | Скопированы 29 файлов раздела `nexus-host/` манифеста (новые: `runner.mjs`, `diag.mjs`, `scoped.mjs`, `power.mjs`, `sentinel\nexus-sentinel.mjs`, `install\*.xml`); хэши в рабочей папке совпадают с манифестом. `v3\actions.mjs` уже совпадал со сборкой (`4e12abfe…`) — не трогался. `capabilities.json` не перезаписан. | PASS |
| C.3 | `get_capabilities`: `diagnostics:true`, `commands:false`, `power:false` (значения по умолчанию); `fileError:null`. Переключатели владельца не менялись. | PASS |
| C.4 | `Start-ScheduledTask NEXUS-Host-Run` → `/healthz` `{"ok":true,"service":"nexus-host","version":"0.6.0-next"}`, PID 3272 | PASS |
| C.5 healthz / tools | `version:"0.6.0-next"`; `tools/list` → **43**; `host_diagnostics` → `capabilitiesFileError:null`, туннель зарегистрирован, `cloudflaredAlive:true` | PASS |
| C.5 caps | `get_capabilities` → `state:"idle"`, `grants.commands=false` | PASS |
| C.5 system_info | `os`, `network`, `power`, `autostart_nexus` — `isError:false`, у всех есть `collectedAt` (11:55:56–11:56:03) | PASS |
| C.5 explorer | `open_app explorer` → `createdByNexus.windows:["Главная — проводник"]`; `finish_task` → окно закрыто (`WindowPattern.Close`), `framesAfterStop:0`, `taskStatus:finished`; чужие окна не затронуты | PASS |
| C.5 STOP | `live_control stop` → `stopped:true`, создан `owner-stop.json`; `open_app explorer` → `stopped_by_owner`. Перезапуск Host штатно (`DELETE /tunnel` → `removed:true`; остановлены node 3272 и его дочерние cloudflared/java; порт свободен; запуск через Планировщик → PID 1472). После перезапуска `open_app` → снова `stopped_by_owner`, `get_capabilities.state = owner_stop` — STOP пережил перезапуск. `live_control resume` → `stopCleared:true`, `owner-stop.json` удалён, `state:idle`. | PASS |

### `system_info {topic:"power"}` (11:56:02)
- Доступно: S3, гибернация, гибридный сон, быстрый запуск. Недоступно: S1, S2, S0 low power idle (не поддерживает прошивка).
- `lastWake`: 0 записей. `wakeTimers`: нет. Батареи нет.
- `wakeArmed`: клавиатуры HID (3), HID-мыши (2), **Realtek Gaming 2.5GbE Family Controller**.
- Схема: AMD Ryzen™ Balanced (`9897998c-…`).

### `system_info {topic:"network"}` (11:56:01), без MAC
- **Активный адаптер: «Беспроводная сеть» — D-Link DWA-182 USB Wi-Fi (rev.D), Up, 585 Mbps**, IPv4 192.168.1.224, шлюз 192.168.1.254, маршрут по умолчанию через него.
- Ethernet (Realtek 2.5GbE) — Disconnected (APIPA). Bluetooth PAN — Disconnected.
- **Флаги WoL: `wol: []`** — тема не вернула ни одной записи. При этом в `power.wakeArmed` Realtek разрешено будить ПК, но кабель не подключён. Ошибкой установки это не считаю (данные получены, `isError:false`). Пустой список стоит разобрать в физической приёмке (P1-2) или в следующей сборке: возможно, `Get-NetAdapterPowerManagement` без прав администратора ничего не возвращает.

### `autostart_nexus`
Задача `NEXUS-Host-Run` (Running, триггер по времени, от `krado`); ключей Run нет; `NEXUS-Host-Logon` и `NEXUS-Sentinel` отсутствуют (D/E не выполнялись).

## F. Шлюз
| Шаг | Факт | Результат |
|---|---|---|
| F.1 | `wrangler deployments list` → текущая `27d66b41-29cb-4f69-b763-b543ccfef476` (совпадает с базой отката). Бэкап `src\*.mjs` → `_backup-0.6.0-pre-20261103\gateway-src`. Перед заменой локальный `src` совпадал с 0.5.2. | PASS |
| F.2 | Скопированы `src\*.mjs` из сборки (по факту изменились только `catalog.mjs`, `handlers.mjs`), хэши 7/7 совпадают с манифестом. `wrangler.toml` и секреты не трогались. | PASS |
| F.3 тесты | **Исходный результат:** 15 тестов, 2 fail (`PC offline: … tools/list still work`, `consent page CSP …`). **Диагностика:** в `nexus-gateway\test` лежали устаревшие тесты от 01.11 (`handlers.test.mjs` старый; `live050.test.mjs` и `offline.test.mjs` отсутствовали). Они проверяли старое поведение, а `src` по хэшам совпадает со сборкой — дефекта в установке нет. **Исправление (1 попытка):** старые тесты сохранены в `_backup-0.6.0-pre-20261103\gateway-test`, в `test\` положены тесты из сборки `0dbd067` (код сборки не менялся). **Повторная проверка:** 31/31, 0 fail. | PASS (после исправления) |
| F.3 deploy | `npx wrangler deploy` (wrangler 4.156.0) → **`d72ba682-26ed-4559-9375-cdbb43106f9e`**; `/health` → `{"ok":true,"service":"nexus-gateway"}` | PASS |
| F.4 | Проверено: `POST /mcp` без токена → 401 (маршрут работает, OAuth на месте); каталог задеплоенного `src` → `VERSION 0.6.0-next`, `TOOLS` = **43**; тест сборки «PC offline: tools/list» проходит; Host после перезапуска зарегистрировал туннель (`registeredAt 10:56:55Z`), его `connection_status` → `host:"reachable"`, туннель `idle_timeouts_recovered` (один обрыв в 10:58Z, восстановлен сам). **Не проверено:** `tools/list` = 43 и вердикт `connection_status` = `online` **через шлюз** — `/mcp` требует OAuth-токен клиента (ChatGPT), а вводить парольную фразу владельца я не могу. | PASS частично / NOT TESTED |
| F.5 | 👤 Владелец: ChatGPT → Settings → Plugins → NEXUS — Windows PC → **Refresh tools** → новый чат; там проверить `tools/list` = 43 и `connection_status` = `online` (закрывает F.4). | ожидает владельца |

## Ошибки и откат
- Единственная ошибка — F.3 (устаревшие тесты в рабочей папке шлюза). Она возникла **до** установки, исправлена допустимым способом (копирование файлов сборки), повторная проверка — PASS.
- Аварийных откатов не было: условия п. 4 правила не выполнялись ни разу.
- Изменений в Smart App Control, Defender, UAC, Firewall, секретах и `main` нет; чужие окна и файлы не тронуты; `capabilities.json` не менялся.
- **Для отката (если понадобится):** Host — бэкап `_backup-0.6.0-pre-20261103` (`workdir\`, `profile\`); шлюз — `npx wrangler rollback 27d66b41-29cb-4f69-b763-b543ccfef476`.

## Состояние после установки
Host 0.6.0-next работает (PID 1472), `state:idle`, STOP снят (`owner-stop.json` нет), окон NEXUS нет. Шлюз — `d72ba682…`. Следующий шаг — F.5 у владельца, затем физическая приёмка по `NEXUS-NEXT-ACCEPTANCE.md` (п. 0 «Подготовка» — переключатели включает владелец).
