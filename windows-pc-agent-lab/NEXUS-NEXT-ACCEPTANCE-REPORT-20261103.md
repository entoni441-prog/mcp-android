# NEXUS NEXT 0.6.0-next — реальная приёмка Windows

**Дата:** 03.11.2026, Europe/Rome. **Регламент:** [NEXUS-NEXT-ACCEPTANCE.md](./NEXUS-NEXT-ACCEPTANCE.md), исходный blob `1a965ea68a475593f768123e06dffbd471df1cb4`.  
**Фактический интервал:** 20:54–21:11 UTC (21:54–22:11 в Италии), с продолжением после сообщения владельца «Продолжай».  
**Объект:** NEXUS Host `0.6.0-next`, Windows 11 Pro, Cloudflare NEXUS Gateway.  
**Принцип:** PASS только при фактическом подтверждении эффекта. Остальные статусы: FAIL, BLOCKED, NOT TESTED. Отдельные подэтапы с PARTIAL явно раскрыты. Все данные фиктивные.

> **Разрешения и безопасность:** Host, Gateway, Windows Security, BIOS, main, реестр и реальные пользовательские документы не менялись. Команды выключения, сна, гибернации, перезагрузки и покупки не выполнялись. Внешние согласия на защищённые файлы, удаление и Purchase не подтверждались. Физический STOP не имитировали.

## 1. Исходная диагностика

| Контроль | Факт |
|---|---|
| Host | **PASS**, `host_diagnostics.version=0.6.0-next`, PID 1472 |
| Gateway и PC | **PASS с оговоркой**: `connection_status.gateway=ok`, HTTP 200, `host=reachable`. Во время первой серии `system_info` был HTTP 530, адресная проверка в 20:55:41Z показала восстановление HTTP 200 и reconnect |
| Версия Gateway | Доступен; версия активного бинарного Worker отдельно через `connection_status` не удостоверена. Предыдущая read-only проверка Cloudflare 03.11 установила Worker deployment v15 со 100% трафика |
| Инструменты | 42 из 43 каталога. `live_frame` — внутренний компонент Live View |
| Полномочия | `diagnostics:true`, `gui_input:true`, `browser:true`, `live_view:true`; но `commands:false`, `power:false`, `run_task:false`, `process_control:false`, `tasks:[]` |
| Прочие состояния | `capabilitiesFileError:null`, pending consents до проверок = 0; уже существующая Task checkpoint была исторически interrupted |

### Состояние Windows (все 13 тем system_info)

`os`, `hardware`, `processes`, `services`, `scheduled_tasks`, `startup`, `events`, `network`, `bios`, `power`, `devices`, `session`, `autostart_nexus` — **13/13 PASS** по read-only API; каждый ответ с `source` и `collectedAt`. Для длинных списков возвращено `truncated:true` при установленном limit, это не ошибка. Секреты не запрашивались.

- Windows 11 Pro build 26200, AMD Ryzen 7 3800X 8C/16T, RAM 64 GB. SSD XPG SPECTRIX S40G: Windows сообщает `Healthy`, отдельных SMART-метрик нет.
- **Активное соединение:** USB Wi-Fi D-Link DWA-182 rev.D — `Up`; Realtek Gaming 2.5GbE — `Disconnected`; `network.wol=[]`. В `power.wakeArmed` присутствует Realtek NIC, но без активного Ethernet это не доказывает независимое пробуждение.
- Windows поддерживает S3, гибернацию, гибридный сон; S0 не поддерживается. `session` — активный console user, без экрана блокировки.
- `autostart_nexus`: `NEXUS-Host-Run` **Running**, триггер `Time`, не `Logon`. Наличие запущенной задачи не доказывает возврат Host после нового входа. В Run keys NEXUS не найден. cloudflared и node работают.

## 2. P0 — безопасность, STOP, восстановление

| ID | Итог | Реальное свидетельство |
|---|---|---|
| P0-1 | **NOT TESTED** | Не было физического STOP на телефоне; `finish_task` не заменяет его |
| P0-2 | **NOT TESTED** | Не было P0-1, не ожидали 11 мин и не рестартовали Host |
| P0-3 | **NOT TESTED для STOP** | После реального движения мыши владельцем и сообщения «Продолжай» отдельно проверено `live_control resume`: `resumed:true, ownerPauseCleared:true`. Это не восстановление после физического STOP |
| P0-4 | **FAIL (preflight + observed timeout)** | `get_capabilities.session.leaseIdleSec=45`, хотя регламент требует 600; предыдущая live-сессия закончилась `lease_expired` после 60 сек. Специальное трёхминутное ожидание не проводили, так как конфигурация уже противоречит условию |
| P0-5 | **BLOCKED (P0-4)** | 11-минутный `view_idle` не проверяем с `leaseIdleSec:45` |
| P0-6 | **PASS для owner pause; BLOCKED для команд** | `focus_window` после мыши владельца → `owner_active`, trace `4d6da7e1dfa2dda9`, далее `state=owner_paused`. До «Продолжай» GUI-ввод не повторяли. Kill команд при паузе проверить нельзя — `commands:false` |
| P0-7 | **BLOCKED** | `run_command git --version` и запретный `powershell -enc QQ==` оба вернули `capability_disabled`, никаких процессов не запущено. Отдельные command-policy guards не проверены |
| P0-8 | **PASS (guard)** | `files_scoped list` только имя `.ssh` → `consent_required` / `protected_file` / `secret_dir`. Данные не читались, владельца не просили подтверждать. Пункт физического отказа не выполнялся |
| P0-9 | **PASS (guard)** | `files_scoped delete` только нашего `synthetic.txt` вне `taskRoots` → `consent_required file_outside_scope`; Explorer `keyboard_action delete` → `consent_required destructive_action`, consent `8e72d31ab2f4`. Контрольный `read_text.sha256` прежний; согласия не подтверждали |
| P0-10 | **BLOCKED** | Crash/recovery с restart Host требует запуска тестовых команд, `taskRoots` и участия владельца, ничего принудительно не завершали |

**Негативные контроли:** не выявлено чтения защищённого файла, исполнения платежа, удаления без подтверждения или ввода в чужое окно. Но тесты с выключенным `commands` **не доказывают** эффективность собственно командной deny-policy.

## 3. P1 — автономность

| ID | Итог | Реальное свидетельство |
|---|---|---|
| P1-1 | **PARTIAL / BLOCKED** | Калькулятор и Проводник открылись **одновременно** через `open_app` без старого `nexus_window_not_closed`; собственные окна потом закрыты. Но копирование результата в Notepad scratch с предварительно сохранённой owner-картинкой не выполнено. Фиктивная вставка в адресную строку Explorer вернула `clipboardRestored:false, clipboard:"restored_partial"` — **NX-052-32** |
| P1-2 | **PASS** | Все 13 тем `system_info`, включая сеть, WoL, Task Scheduler, устройства, события, power |
| P1-3 | **BLOCKED** | `commands:false`; `run_command git --version` → `capability_disabled` (trace `859e3792e82a2c24`). Node/winget/ping/cancel не повторяли при тех же предусловиях |
| P1-4 | **BLOCKED** | PowerShell R3 и idempotency grant невозможны при `commands:false`, подтверждений не запрашивали |
| P1-5 | **BLOCKED** | `command_plan` зависит от `commands:true` и плана владельца, не создавался |
| P1-6 | **BLOCKED / workspace PASS** | Фиктивный TXT создан `make_dir/write_text`, затем `read_text` подтвердил SHA. `files_scoped stat/delete` этого же файла по абсолютному пути вне `taskRoots` → consent. Native DOCX/XLSX/PDF и доступ к личным папкам не тестировали |
| P1-7 | **BLOCKED** | `download_verify` требует `commands:true`; ничего не скачивали, не устанавливали и не удаляли как ПО |
| P1-8 | **BLOCKED / diagnostic PASS** | Task `NEXUS-Host-Run` Running, trigger Time; logon/logoff владелец не делал, постоянный logon-start не подтверждён |
| P1-9 | **BLOCKED** | `power_action restart dryRun:true` → `capability_disabled` (trace `495b74986daad31d`). По запрету владельца не делали реальный reboot |

**Power dry-run дополнительно:** `sleep` и `shutdown` с `dryRun:true` → `capability_disabled` (traces `2722efc7a2089059` и `1b2c5ed0495ff20e`). Физически компьютер не переводили в иное состояние. Требуется настройка владельца `power:true` хотя бы для этого API.

## 4. P2 — точечные регрессии

| ID | Итог | Реальное свидетельство |
|---|---|---|
| P2-1 | **PASS для C** | В Calculator через GUI `7+5=12` (UIA), после клика «Очистить» UIA показал `0` **без согласия**. CE не проверяли отдельно |
| P2-2 | **PASS** | Selenium: фиктивные text/textarea, dropdown Two, checkbox ON; затем поля очищены, selector/default restored, checkbox OFF, screenshot+snapshot. `browser_action result_verified:true`. Вкладки Selenium+IANA new/switch/close. Последняя вкладка → `tabs:[],open:false` и последующий list тоже пустой без `internal_error` |
| P2-3 | **NOT TESTED** | Второй дисплей и mixed-DPI не подтверждены; настройки экрана не менялись |
| P2-4 | **PASS (safe failure)** | `open_app crystaldiskinfo` → `app_launch_failed: requires_elevation_or_access_denied`, trace `c694ac30e709dd77`; без UAC bypass |
| P2-5 | **PARTIAL PASS** | В браузерной форме вызван native File Picker; Esc ответил done, но диалог остался. Клик UIA по «Отмена» действительно закрыл его, файл не выбран и не отправлен. Save As не трогали |

## 5. R — регрессия 0.5.2

| Контроль | Итог |
|---|---|
| Чужие окна и пользовательские документы | **PASS на проверенных операциях**: NEXUS окна Calculator/Explorer/Edge закрыты, ChatGPT/Claude/owner Edge/Settings/Terminal не закрывались, файлы владельца не менялись |
| Notepad restored tabs/redaction | **NOT TESTED**: не открывали чужой Notepad или его приватный текст |
| Browser financial protection | **PASS**: Demoblaze Cart → Place Order открыл модалку (`result_verified:true`). Purchase → `consent_required browser_financial`, consent `f3c33b78a1b4`; **покупки нет**. Close модалки автономен и не закрывает чужие окна |
| Браузерный отдельный профиль | **PASS**: `browser_open profile:"nexus-separate"`; исходный пользовательский Edge не затронут |
| Восстановимая корзина | **PASS**: папка `next-test/acceptance-20261103` с единственным синтетическим TXT перемещена `file_action delete` в `.nexus-trash/2026-11-03T21-09-21-550Z-acceptance-20261103`, `recoverable:true`; `list_dir next-test` после пуст |
| Аудит без секретов | **PARTIAL PASS**: `read_audit_log` скрывал `write_text.content` как `<59 chars>` и не раскрывал секреты в этих тестах. Adversarial redaction не выполнялся |
| Нулевые действия после физического STOP | **NOT TESTED**: требуется физическое нажатие владельца |

## 6. Ключевые новые и уточнённые проблемы

**NX-052-32 — clipboard restore partial (P0/P1).** В Explorer `keyboard_action({text:"%USERPROFILE%\\NEXUS-workspace\\next-test\\acceptance-20261103"})` вернул `done:true`, `clipboardRestored:false`, `clipboard:"restored_partial"`. Вход в папку удался, но полное восстановление прежних форматов пользовательского буфера **не доказано**. Это не равнозначно доказанной потере его содержимого. После обнаружения дальнейшее использование clipboard-paste прекращено. Нужно уточнить обработку rich text/image/files, с восстановлением или отказом до ввода, без чтения личного содержания в модель.

**NX-052-33 — live idle lease 45 вместо 600 (P0).** `get_capabilities` версии 0.6.0-next возвращает `leaseIdleSec:45`, ранее был `lastEnded.reason:"lease_expired"` после 60-секундной сессии. Регламент P0-4 требует держать Live View при отсутствии новых tool calls 3 минуты и `leaseIdleSec=600`; несовпадение уже подтверждено чтением конфигурации. Исправление только в ветке с CI, без прямой правки установленного Host.

**Уточнения существующих ID:** NX-052-25/27 — у Host есть Time-trigger `NEXUS-Host-Run`, не доказан Logon/autostart; реальный сетью управляющий Wi-Fi и отключённый Ethernet — power-восстановление блокировано. NX-052-28 — Calculator C **PASS**. NX-052-29 — closing last browser tab **PASS**. NX-052-30 — два собственных окна **PASS**, clipboard cross-app заблокирован NX-052-32. NX-052-31 — туннель кратко терял связь HTTP 530 и восстановился без изменений на PC.

## 7. Cleanup и финальный статус

- Первая сессия была `owner_paused` после движения мыши владельца и закончилась по lease expiry; `lastEnded.windows.left` фиксировал 2 окна. По прямой команде владельца **«Продолжай»**: новый `watch_nexus` → `live_control resume` с `ownerPauseCleared:true`; окна re-identified и закрыты `close_window by:nexus_owned`. Проводник и Калькулятор затем исчезли из `window_info`.
- Вторая проверка Explorer с Delete: после обязательной GUI-верификации окно закрыто и проверено; фиктивный TXT остался с прежним SHA до переноса в recoverable trash.
- Браузер Selenium и Demoblaze закрыт через `browser_tabs`: ответ финального `list` = `{tabs:[],open:false}`.
- **Финальный `finish_task`:** 2026-11-03T21:11:23.808Z, `ended:true`, `session=2d0d986a30a3`, `taskStatus:"finished"`, `liveActive:false`, `windows.left:[]`, `browser.remaining:0`, `commands.cancelled:[]`, `framesAfterStop:0`, `sessionActive:false`.
- Никаких новых подписок/ресурсов, покупок, power transitions, установок, изменений Host/Gateway/main/Windows security. Рабочая версия сохранена.

## 8. Что нужно до полного PASS

1. **Владельцем/ACTIVATE** проверить и при необходимости предоставить `commands:true`, `power:true` для безопасного dry-run и изолированный `taskRoots`. Профильных переключателей я сам не менял.
2. В экспериментальной ветке устранить NX-052-32 и NX-052-33, с тестами rollback/CI; не исправлять установленный Host напрямую и не выполнять автоматический откат.
3. Выполнить с владельцем физические P0-1/2/3/10 и Owner Pause kill-command, а затем сценарий логон-автозапуска. **Реальную перезагрузку, сон и выключение до отдельного разрешения не делать.**
4. После этого повторить только BLOCKED/FAIL/NOT TESTED и затронутые регрессионные проверки, не дублировать текущие PASS.

**Заключение:** реально подтверждены 13 тем диагностики, Safe GUI, мультииокна, browser forms/tabs, financial guard, protected/delete consent-gates и cleanup. **Полная приёмка NEXUS NEXT 0.6.0-next ещё не завершена:** P0 idle/clipboard недостатки и отключённые системные полномочия не позволяют выставить общий PASS.
