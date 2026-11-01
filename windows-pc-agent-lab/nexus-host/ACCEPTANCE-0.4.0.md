# NEXUS 0.4.0 — поставка и единая приёмка

Ветка `experiment/nexus-0.4.0-20261101`. 0.3.0 (`c63fe10`, ветка `experiment/nexus-host-mcp-20261101`) не изменён.

## Что входит (25 инструментов = 7 из 0.3.0 + 18 новых)
| Группа | Инструменты | По умолчанию |
|---|---|---|
| Диагностика | `image_selftest` | вкл |
| Экран | `capture_screen` | вкл (`screen_capture`) |
| Окна/UIA (только inputApps) | `focus_window`, `window_info`, `inspect_ui` | вкл (`ui_read`) |
| Ввод (только inputApps) | `mouse_action`, `keyboard_action` | **выкл** (`gui_input`) |
| Процессы | `list_processes`, `read_audit_log` | вкл |
| | `process_action` | **выкл** (`process_control`) |
| Задачи владельца | `run_task`, `task_status`, `task_cancel` | **выкл** (`run_task`), список задач пуст |
| Файлы workspace | `search_files`, `file_action` | вкл |
| Браузер (отдельный профиль Edge) | `browser_open`, `browser_snapshot`, `browser_action` | **выкл** (`browser`) |

Настройки: `%USERPROFILE%\.nexus-host\capabilities.json` (создаётся при первом запуске, вне workspace — инструменты его изменить не могут). Жёсткий запрет, не отключаемый файлом: терминалы/оболочки (cmd, PowerShell, pwsh, Windows Terminal, conhost, wsl, bash), скриптовые хосты, UAC (consent), LogonUI, explorer, regedit, mmc, taskmgr, node, java, python, cloudflared, Bitwarden и др. (`capabilities.mjs → HARD_DENY`).

## Поставка (один раз)
1. В окне NEXUS 0.3.0 — Ctrl+C (доступ ChatGPT выключается).
2. Резервная копия: папку `Documents\NEXUS` скопировать в `Documents\NEXUS-0.3.0-backup`.
3. Заменить файлы (доставляет облачная сессия через мост, сверка sha256):
   `nexus-host/`: `server.mjs`, `nexus.mjs`, `catalog.mjs`, `capabilities.mjs`, `gui.mjs`, `uia-script.mjs`, `NexusRobot.java`, `procs.mjs`, `files.mjs`, `browser.mjs`; `v3/actions.mjs` (добавлен только export); `nexus-gateway/src/catalog.mjs`.
4. `cd nexus-gateway` → `npx wrangler deploy` (меняется только каталог инструментов, логика OAuth/шлюза та же).
5. `node nexus-host\nexus.mjs` — в окне должна появиться строка `Capabilities (...): screen_capture=ON ui_read=ON gui_input=off ...`. Ctrl+C.
6. В `capabilities.json` поставить `"gui_input": true, "process_control": true, "browser": true, "run_task": true` и добавить задачу:
   `"tasks": {"whoami": {"exe": "C:\\Windows\\System32\\whoami.exe"}}`. Снова `node nexus-host\nexus.mjs`.

Откат: Ctrl+C → вернуть файлы из `NEXUS-0.3.0-backup` → `npx wrangler deploy` из резервной `nexus-gateway`.

## Приёмка — НОВЫЙ чат ChatGPT (старый кэширует каталог), режим Always ask
| # | Запрос ChatGPT | Критерий PASS |
|---|---|---|
| 1 | `image_selftest` и назови цвета 4 квадратов | белый/синий/зелёный/красный. Иначе — блокер ImageContent, продолжаем |
| 2 | `open_app notepad` → `list_windows` → pid Notepad → `focus_window` | `focused:true` |
| 3 | `keyboard_action text "Привет от NEXUS 0.4.0"` → `capture_screen` | текст в Блокноте, на снимке видно |
| 4 | `inspect_ui` Notepad → клик `mouse_action` по центру пункта меню «Файл/File» → `capture_screen` | меню открыто (проверка DPI: rect UIA ↔ координаты мыши) → `keyboard_action keys "esc"` |
| 5 | `mouse_action click` в точку панели задач (внизу экрана) | `target_not_allowed` |
| 6 | Ты сам переводишь фокус на окно PowerShell, затем `keyboard_action text "dir"` | `focus_not_allowed`, в PowerShell ничего не введено |
| 7 | `process_action close` Notepad | Блокнот спрашивает о сохранении — ты нажимаешь «Не сохранять» |
| 8 | `browser_open https://example.com` → `browser_snapshot` → `browser_action click` по ссылке | новый URL, отдельное окно Edge без твоих вкладок/входов |
| 9 | `browser_open http://127.0.0.1:8765/mcp` | `url_not_allowed` |
| 10 | `run_task whoami` → `task_status` | вывод имени пользователя |
| 11 | `search_files`, `file_action copy` и `delete` в workspace | файл в `.nexus-trash` |
| 12 | `read_audit_log lines 20` | все вызовы есть, введённый текст записан только длиной |

После приёмки: вернуть `gui_input/process_control/browser/run_task` в нужные тебе значения.

## Проверено автоматически (CI, GitHub-hosted Windows Server + Ubuntu)
- Java 17 Temurin Robot: снимок, мышь, клавиши, отказ `win`/вне экрана/неизвестных команд.
- Windows PowerShell 5.1 UIA: `window_info`, `inspect_ui`, `focus_window` **переключил фокус между двумя Notepad через AppActivate(pid) и подтвердил через UIA**, `keyboard_action` (кириллица через буфер, заголовок стал `*Untitled`), `mouse_action` внутри Notepad — выполнен, вне его — `target_not_allowed`.
- Реальный Edge (Windows) и Chrome (Linux) по CDP: открытие, snapshot, ввод, клик, отказ для password, file:, javascript:.
- Каталог шлюза побайтно совпадает с каталогом Host; официальный MCP Python SDK видит 25 инструментов.

## Не проверено (только в приёмке на твоём ПК)
- Принимает ли ChatGPT изображения из MCP (`image_selftest`, `capture_screen`).
- Масштабирование >100 % (на раннере 100 %); проверка — шаг 4.
- Поведение фокуса у фонового Host на твоём ПК (на раннере сработало), Notepad Win11 (на раннере классический), Calculator (UWP).
- Время ответа через шлюз: холодный старт Java ≈ 5 с (прогрев при запуске Host).
