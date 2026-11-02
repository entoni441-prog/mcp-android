# NEXUS 0.5.2 — отчёт об установке и откате (02.11.2026)

**Итог:** 0.5.2 не принят. Host откатан на 0.5.1-b. Шлюз не деплоился. Задача Планировщика не восстанавливалась.

Время — UTC. Значения `token.txt`, консент-идентификаторы, аргументы инструментов с путями и текстом, имя пользователя в путях в отчёт не включены. Разделы «Вывод» отделены от фактов.

## Хронология запусков Host

| Запуск | Версия | PID node / cloudflared | Регистрация туннеля | Как завершился |
|---|---|---|---|---|
| 1 | 0.5.2 | 9376 / 6632 | 17:05:42 | остановлен вручную при откате: критерий smoke `live_frame` |
| 2 | 0.5.1-b | 17656 / 10588 | 17:07:46 | остановлен вручную перед повторной установкой |
| 3 | 0.5.2 | 11068 / 5820 | 17:25:37 | **завершился сам, причина неизвестна** (см. п. 1) |
| 4 | 0.5.2 | 14040 / 15764 | 17:27:04 | остановлен вручную при откате: дефект `inspect_ui` |
| 5 | 0.5.1-b | 7632 / 19396 | 17:39:11 | работал на момент отчёта |

## 1. Текст ошибки первого запуска 0.5.2

**Точного текста нет: он нигде не был сохранён.** Восстановить его по догадке нельзя.

Уточнение: первый запуск 0.5.2 (№ 1) не падал. Он штатно прошёл старт и был остановлен вручную. Неожиданно завершился запуск № 3, ниже речь о нём.

- Host запускался через Планировщик в собственном окне консоли. stdout и stderr никуда не перенаправлялись, окно я не наблюдал, и к моменту проверки оно уже закрылось.
- Последний успешный ответ: `audit.log` 17:25:45.652. Первый отказ: `Подключение не установлено, т.к. конечный компьютер отверг запрос на подключение` на следующем вызове. Проверка в 17:26:14: порт 8765 не слушается, PID 11068 и 5820 не существуют.
- `tunnel.log`: последние записи запуска — `registered startup` и `Registered tunnel connection` в 17:25:37. Записи `cloudflared_exit` после них нет.
- `audit.log`: записи об остановке нет.
- Журналы Windows Application и System за 17:25:30–17:26:30: событий нет. Отчётов WER и дампов для node и cloudflared нет. Журнал `TaskScheduler/Operational` событий не содержит, Security 4689 недоступен.

**Вывод (предположение):** `nexus.mjs:82` пишет `cloudflared_exit` при выходе cloudflared, пока работает node. Отсутствие записи указывает, что node завершился первым или оба процесса были завершены одновременно, например при закрытии окна консоли или принудительном завершении. Сбой кода, внешнее завершение и закрытие окна этими данными не различаются.

**Воспроизведение:** запуск № 4 повторил те же вызовы и прошёл 60 с простоя, удаление задачи Планировщика, ещё 60 с и smoke с ещё 60 с ожидания. Падения не было. Отличие: в запуске № 3 задача была удалена примерно через 8 с после регистрации туннеля, в № 4 — примерно через 56 с. Причинная связь не установлена.

## 2. `inspect_ui` на Проводнике

Окно: тестовая папка, открытая вручную (`explorer.exe`, PID 19032, класс `CabinetWClass`). `window_info` на этом окне отвечал успешно, `foreground:true`.

Запросы и ответы (аудит 17:33:58–17:34:12, все четыре вызова `inspect_ui` завершились одинаково):

```text
tools/call inspect_ui {"pid":19032,"maxDepth":8,"maxNodes":400}  ->  isError: error: uia_failed
tools/call inspect_ui {"pid":19032}                              ->  isError: error: uia_failed
tools/call inspect_ui {"pid":19032,"maxDepth":4,"maxNodes":150}  ->  isError: error: uia_failed
tools/call inspect_ui {"pid":19032,"maxDepth":6,"maxNodes":200}  ->  isError: error: uia_failed
```

Поле `detail` из `audit.log` дословно. Запись обрезается Host на 500 символах (`gui.mjs:112`), а кириллица повреждена при записи:

```text
#< CLIXML
<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T><T>System.Object</T></TN><MS><I64 N="SourceId">1</I64><PR N="Record"><AV>�����⮢�� ���㫥� � ��ࢮ�� �ᯮ�짮�����.</AV><AI>0</AI><Nil /><PI>-1</PI><PC>-1</PC><T>Completed</T><SR>-1</SR><SD> </SD></PR></MS></Obj><S S="Error">ForEach-Object : ���������� �맢��� ��⮤ ��� ��ࠦ���� � ���祭��� NULL._x000D__x000A_</S><S S="Error">��ப�:
```

Предположительное прочтение: «Подготовка модулей к первому использованию», затем `ForEach-Object : Невозможно вызвать метод для выражения со значением NULL`. Номер строки скрипта в обрезанную запись не попал, поэтому точное место ошибки не установлено.

Контроль: тот же инструмент на окне «Таблица символов» (`charmap`, 17:34:26) вернул дерево элементов. Значит, сбой относится к Проводнику, а не к `inspect_ui` в целом. При этом защита удаления на Проводнике сработала: `delete` → `consent_required` (`destructive_action`, `keys:delete on selection (ListItem)`), поэтому получение контекста под фокусом работает.

## 3. `audit.log`, 17:15–17:40

Строки с `trace` создаёт шлюз: `trace` формируется в `nexus-gateway/src/handlers.mjs:154` и передаётся в Host. Локальные вызовы этого отчёта идут без него.

**Четыре строки с `trace` (17:20:42–17:21:25) — не мои.** По коду это вызовы через шлюз; кто стоял за ними, журнал не показывает. На тот момент работал Host 0.5.1-b (запуск № 2). Остальные строки — мои проверки или вызванные ими события Host. Вызов `live_frame` Host не записывает намеренно (`server.mjs:314`), поэтому его здесь нет.

В столбце «Детали» приведены только класс действия, причина или решение, без аргументов.

| Время | Инструмент / событие | trace | Результат | Детали |
|---|---|---|---|---|
| 17:20:42.320 | `list_windows` | `303a00badf92936e` | ok |  |
| 17:20:42.732 | `get_capabilities` | `910a1ba64dbf76c4` | ok |  |
| 17:20:58.977 | `manage_app_access` | `d230d01b649e0390` | fail | app_hard_denied |
| 17:21:25.632 | `finish_task` | `a4685de649df44f9` | ok |  |
| 17:25:01.905 | `host_diagnostics` | — | ok |  |
| 17:25:45.101 | `get_capabilities` | — | ok |  |
| 17:25:45.590 | `manage_app_access` | — | ok |  |
| 17:25:45.601 | `finish_task` | — | ok |  |
| 17:25:45.652 | `manage_app_access` | — | ok |  |
| 17:29:00.875 | `manage_app_access` | — | ok |  |
| 17:29:00.890 | `finish_task` | — | ok |  |
| 17:30:59.127 | `manage_app_access` | — | ok |  |
| 17:30:59.537 | `list_windows` | — | ok |  |
| 17:30:59.558 | событие `session_start` | — | — |  |
| 17:31:00.075 | событие `handoff_requested` | — | — | notepad_cold_start_session_restore |
| 17:31:00.076 | `open_app` | — | ok |  |
| 17:31:00.175 | `capture_screen` | — | fail | owner_handoff_active |
| 17:31:19.675 | `task_status` | — | ok |  |
| 17:31:19.680 | событие `handoff_declined` | — | — | notepad_cold_start_session_restore |
| 17:31:19.681 | `task_cancel` | — | ok |  |
| 17:31:19.684 | `task_status` | — | ok |  |
| 17:31:19.693 | событие `consent_required` | — | — | protected_file |
| 17:31:19.693 | `read_text` | — | ok |  |
| 17:31:19.696 | событие `consent_required` | — | — | protected_file |
| 17:31:19.697 | `read_text` | — | ok |  |
| 17:31:19.701 | `read_text` | — | ok |  |
| 17:31:19.706 | событие `consent_decision` | — | — | cancel |
| 17:31:19.706 | `confirm_action` | — | ok |  |
| 17:31:19.710 | событие `consent_decision` | — | — | cancel |
| 17:31:19.710 | `confirm_action` | — | ok |  |
| 17:31:45.818 | событие `nexus_created` | — | — |  |
| 17:31:45.819 | `open_app` | — | ok |  |
| 17:31:49.725 | `close_window` | — | ok |  |
| 17:31:51.199 | `open_app` | — | fail | app_not_found |
| 17:31:52.799 | событие `nexus_created` | — | — |  |
| 17:31:52.800 | `open_app` | — | ok |  |
| 17:31:53.317 | `open_app` | — | fail | app_not_found |
| 17:31:53.801 | `open_app` | — | fail | app_not_found |
| 17:31:55.149 | `browser_open` | — | ok |  |
| 17:31:58.170 | `browser_snapshot` | — | ok |  |
| 17:32:15.494 | `inspect_ui` | — | fail | app_not_allowed |
| 17:32:16.053 | `focus_window` | — | fail | app_not_allowed |
| 17:32:16.586 | `close_window` | — | fail | app_not_allowed |
| 17:32:18.612 | `host_diagnostics` | — | ok |  |
| 17:32:51.446 | `close_window` | — | ok |  |
| 17:32:53.500 | `browser_snapshot` | — | ok |  |
| 17:33:05.506 | `browser_open` | — | ok |  |
| 17:33:08.548 | `browser_snapshot` | — | ok |  |
| 17:33:08.914 | `browser_action` | — | ok |  |
| 17:33:11.947 | `browser_snapshot` | — | ok |  |
| 17:33:12.537 | `browser_action` | — | ok |  |
| 17:33:16.550 | `browser_snapshot` | — | ok |  |
| 17:33:16.874 | `browser_action` | — | ok |  |
| 17:33:18.898 | `browser_snapshot` | — | ok |  |
| 17:33:31.185 | `browser_action` | — | ok |  |
| 17:33:31.224 | `browser_action` | — | ok |  |
| 17:33:31.232 | событие `consent_required` | — | — | browser_financial |
| 17:33:31.232 | `browser_action` | — | ok |  |
| 17:33:31.239 | событие `consent_decision` | — | — | cancel |
| 17:33:31.240 | `confirm_action` | — | ok |  |
| 17:33:33.251 | `browser_snapshot` | — | ok |  |
| 17:33:34.247 | событие `session_end` | — | — | finish_task |
| 17:33:34.248 | `finish_task` | — | ok |  |
| 17:33:38.276 | `get_capabilities` | — | ok |  |
| 17:33:38.651 | `list_windows` | — | ok |  |
| 17:33:42.108 | `list_windows` | — | ok |  |
| 17:33:56.952 | `list_windows` | — | ok |  |
| 17:33:56.997 | событие `session_start` | — | — |  |
| 17:33:57.518 | `focus_window` | — | ok |  |
| 17:33:58.237 | `inspect_ui` | — | fail | uia_failed |
| 17:34:11.320 | `inspect_ui` | — | fail | uia_failed |
| 17:34:11.927 | `inspect_ui` | — | fail | uia_failed |
| 17:34:12.555 | `inspect_ui` | — | fail | uia_failed |
| 17:34:13.076 | `window_info` | — | ok |  |
| 17:34:24.819 | событие `nexus_created` | — | — |  |
| 17:34:24.820 | `open_app` | — | ok |  |
| 17:34:26.364 | `inspect_ui` | — | ok |  |
| 17:34:29.146 | `close_window` | — | ok |  |
| 17:34:49.694 | `window_info` | — | ok |  |
| 17:34:50.839 | `keyboard_action` | — | ok |  |
| 17:34:52.342 | `window_info` | — | ok |  |
| 17:34:52.947 | событие `consent_required` | — | — | destructive_action |
| 17:34:52.947 | `keyboard_action` | — | ok |  |
| 17:34:53.968 | событие `consent_decision` | — | — | cancel |
| 17:34:53.968 | `confirm_action` | — | ok |  |
| 17:34:56.078 | `keyboard_action` | — | ok |  |
| 17:34:57.572 | `window_info` | — | ok |  |
| 17:34:58.160 | событие `consent_required` | — | — | destructive_action |
| 17:34:58.161 | `keyboard_action` | — | ok |  |
| 17:34:58.179 | событие `session_end` | — | — | finish_task |
| 17:34:58.180 | `finish_task` | — | ok |  |
| 17:34:58.529 | `list_windows` | — | ok |  |
| 17:35:24.289 | событие `session_start` | — | — |  |
| 17:35:24.291 | событие `consent_decision` | — | — | cancel |
| 17:35:24.291 | `confirm_action` | — | ok |  |
| 17:35:26.380 | `host_diagnostics` | — | ok |  |
| 17:35:26.388 | `get_capabilities` | — | ok |  |
| 17:35:35.877 | событие `session_end` | — | — | finish_task |
| 17:35:35.877 | `finish_task` | — | ok |  |
| 17:35:35.907 | `get_capabilities` | — | ok |  |
| 17:38:41.168 | `host_diagnostics` | — | ok |  |
| 17:39:37.968 | `get_capabilities` | — | ok |  |
| 17:39:37.997 | `host_diagnostics` | — | ok |  |

## 4. Задача Планировщика

**До установки задачи Host не было.**

- Проверка перед установкой (фильтр имени `nexus` в `Get-ScheduledTask` и `schtasks /Query`): пусто. Host в этот момент не работал: порт 8765 закрыт, процессов нет.
- Ограничение: та проверка смотрела только имена, не действия. Задача с другим именем, запускающая Host, ею не обнаружилась бы.
- Проверка после всех работ, по именам и действиям всех задач (`nexus`, `cloudflared`), и по `System32\Tasks`: пусто. Удалял я только задачу ниже, поэтому задачи с другим именем в списке остались бы; их нет. Журнал истории Планировщика пуст, подтвердить историю им нельзя.
- `HKCU\...\Run` и папка автозагрузки: упоминаний NEXUS нет.

**Что создано и удалено.** Единственная задача — `NEXUS-Host-Run`, созданная мной:

```text
schtasks /Create /F /TN "NEXUS-Host-Run" /SC ONCE /ST 23:59 /SD 01/01/2030 /IT /RL LIMITED
  /TR "\"C:\Program Files\nodejs\node.exe\" \"%USERPROFILE%\Documents\NEXUS\nexus-host\nexus.mjs\""
```

| Создана для запуска | Удалена |
|---|---|
| № 1, затем повторно использована для № 2 | после старта № 2, около 17:08 |
| № 3 | около 17:25:45 |
| № 4 | 17:28:00 |
| № 5 | около 17:39:40 |

Удаление `ACTIVATE-0.5.2.md` не предписывает. Я перенёс его из шага 5 `RESTART-HOST.md`, чтобы не оставлять постоянную задачу. По твоей команде задача не восстановлена: сейчас её нет.

Также удалены из рабочей папки Host при обоих откатах: `policy.mjs`, `handoff.mjs`, `discover.mjs` (новые файлы 0.5.2). Остальные 18 файлов восстановлены из `_backup-0.5.1b-20261102`, SHA-256 совпали.

## 5. UAC `consent.exe`, PID 17804

**Наиболее вероятная причина: установка GitHub CLI через WinGet.** Не NEXUS и не команды этой установки: процесс запущен за 4,5 часа до них.

| Факт | Значение |
|---|---|
| `consent.exe` | PID 17804, родитель PID 5472 — `svchost.exe`, служба `Appinfo`; создан 12:35:26.59 |
| `msiexec.exe` | PID 5488, родитель `services.exe`; создан 12:35:26 |
| Application, `MsiInstaller` 1040, 12:35:26 | начало транзакции `%LOCALAPPDATA%\Temp\WinGet\GitHub.cli.2.103.3\gh_2.103.3_windows_amd64.msi`, клиентский PID 15956 |
| PID 15956 | уже не существует; процессов winget нет |
| Сессия Claude Code, PID 9900 | создана 12:35:18, за 8 с до этого; связь только по времени |
| `gh` | не установлен: нет в PATH и в `Program Files\GitHub CLI` |
| Состояние на момент отчёта | `consent.exe` ещё работает; я его не трогал |

**Вывод:** связь `consent.exe` с MSI определена по совпадению времени: командная строка и родитель инициатора недоступны без повышения прав. Кто запустил `winget`, неизвестно. Подтверждение UAC не завершено, что согласуется с отсутствием `gh`, но само по себе этого не доказывает.
