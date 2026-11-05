# NEXUS NEXT 0.6.1c — отчёт об установке (ACTIVATE-NEXT-0.6.1c: A, B, C, C.5 оба варианта с `/t`)

**Дата:** 05.11.2026, ~08:00–08:06 UTC. **Исполнитель:** локальный Claude Code на ПК владельца. **Разрешение:** владелец разрешил (запрос 05.11); шлюз, задачи Планировщика и `power` не трогались.
**Правило ошибок:** «Правило ошибок и отката» из `ACTIVATE-NEXT-0.6.0.md`.

## Итог
| Этап | Результат |
|---|---|
| A. Проверка | **PASS** |
| B. Бэкап | **PASS** |
| C. Замена и перезапуск (C.1–C.4) | **PASS** — дерево PID разорвано |
| C.5.1 `taskkill /t` по Host | **PASS** — supervisor жив, Host поднят за 39 с |
| C.5.2 `taskkill /t` по supervisor | **PASS** — Host без перерыва, новый supervisor за 44 с |
| C.5.4 Кириллица | **PASS** |
| H (владелец) | не выполнялось (только владелец) |
| Откаты | не применялись (ошибок не было) |

- **HEAD:** `b4779734161c10283013d6b7d417ec8f6a90f102` (worktree `Documents\NEXUS\_src-next-0.6.1c`). Вершина ветки при установке — `98ae91c` (после `b477973` изменён только `NEXUS-NEXT-0.6.1-REPORT.md`).
- **PID до установки:** Host `13772`, supervisor `18616` (ParentProcessId supervisor'а = `13772` — тот самый дефект 0.6.1b).
- **После C.3:** Host `11800`, supervisor `10348` (ParentProcessId `17988` — посредник, уже завершён).
- **После C.5.1:** Host `7528`, supervisor `10348` (не изменился).
- **После C.5.2 (сейчас):** Host `7528` (не изменился), supervisor `3540` (ParentProcessId `14368` — посредник).
- **Шлюз:** не трогался — `b6c89bc7-e99e-4042-8762-34524d4363dd`.

## A. Проверка
| Шаг | Факт | Результат |
|---|---|---|
| A.0 | `_src-0.5.2` (`4e316c6`) и `_src-next-0.6.1b` (`424994b`): `git status --porcelain` пуст; `git stash list` пуст | PASS |
| A.1 | `fetch` → вершина `98ae91c`; `worktree add --detach _src-next-0.6.1c b477973`; `rev-parse HEAD` = `b477973…` | PASS |
| A.2 манифест | `MANIFEST-NEXT-0.6.1.sha256`: 38 строк, расхождений нет. На ПК от манифеста отличались ровно `nexus-supervisor.mjs` и `nexus.mjs` (остальные 28 файлов Host уже совпадали). | PASS |
| A.2 тесты | Host без `*-real`: 249 тестов, **245 pass, 0 fail**, 4 skip | PASS |

## B. Бэкап → `Documents\NEXUS\_backup-0.6.1c-pre-20261105`
| Шаг | Факт | Результат |
|---|---|---|
| B | `nexus-supervisor.mjs` (`BBC030ED…`), `nexus.mjs` (`99823950…`) + `SHA256.txt` | PASS |

## C. Замена и перезапуск
| Шаг | Факт | Результат |
|---|---|---|
| C.1 | `host.pid` = 13772, `supervisor.pid` = 18616. `owner-stop.json` и `host-off` нет (не создавались). `taskkill /pid 18616 /f` → `DELETE /tunnel` → `200 {"ok":true,"removed":true}` → `taskkill /pid 13772 /f`. cloudflared 14216 завершился сам; процессов NEXUS не осталось, порт 8765 свободен. | PASS |
| C.2 | Скопированы `nexus-supervisor.mjs`, `nexus.mjs`; хэши = манифест | PASS |
| C.3 | `Start-ScheduledTask NEXUS-Host-Run` → `/healthz` `0.6.1-next`; Host `11800` (`supervised:false`). `tunnel.log`: `tunnel_start quic` → `supervisor_started launcher 17988` → `supervisor daemon up (pid 10348)` → `registered startup` → cloudflared `Registered tunnel connection … protocol=quic`. `audit.log`: `start`. | PASS |
| C.4 | `ParentProcessId` supervisor'а 10348 = **17988** (посредник, процесса уже нет) ≠ PID Host 11800 | PASS |

## C.5 Самовосстановление
| Шаг | Факт | Результат |
|---|---|---|
| C.5.1 дерево Host | До: Host 11800, supervisor 10348. `taskkill /pid 11800 /t /f` завершил только дерево Host (Host, cloudflared 17116 и их дочерние 9560, 12264, 10496, 17528); **supervisor 10348 жив, PID не изменился**. **Через 39 с** `/healthz` отвечает; `host.pid` = **7528**, `supervised:true`. `tunnel.log`: `supervisor starting host (restart 1)` → `tunnel_start quic` → `registered startup` → cloudflared `Registered tunnel connection`. `audit.log`: `start` (`supervised:true`). | PASS (≤60 с) |
| C.5.2 дерево supervisor | До: Host 7528, supervisor 10348. `taskkill /pid 10348 /t /f` завершил **только** 10348. Host 7528 жив: `/healthz` опрашивался каждую секунду — 44 проверки, **0 пропусков**; `host.pid` тот же. **Через 44 с** новый `supervisor.pid` = **3540** (ParentProcessId `14368` — посредник ≠ Host). `tunnel.log`: `supervisor_started launcher 14368` → `supervisor daemon up (pid 3540)`. | PASS (≤70 с) |
| C.5.3 без `/t` | по инструкции не повторялся (PASS в 0.6.1b) | — |
| C.5.4 кириллица | `run_command powershell ["-NoProfile","-Command","(Get-Date).ToString('dddd', [Globalization.CultureInfo]'ru-RU')"]` → R3, exit 0, stdout **`четверг`** | PASS |

## Состояние после установки
Host `0.6.1-next` (PID `7528`, `supervised:true`), supervisor `3540`, `state: idle`, `tools/list` → 43, `connection_status` → `reachable`, туннель QUIC, verdict `ok`. `ownerBans: ["power"]`, `power: false` — без изменений. Задачи `NEXUS-Host-Run`, `NEXUS-Host-Logon` — `Ready`, не изменялись.
**Откат (если понадобится):** остановить supervisor и Host по PID → вернуть два файла из `_backup-0.6.1c-pre-20261105` → `NEXUS-Host-Run`.

## H. Только владелец (не выполнялось)
1. Удалить `%USERPROFILE%\.nexus-host\owner-passphrase.txt` — файл всё ещё на диске.
2. Сменить пароль `/live` и записать новый хэш в секрет шлюза — команды в `ACTIVATE-NEXT-0.6.1c.md`, раздел H.
