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
   `nexus-host/`: `server.mjs`, `nexus.mjs`, `catalog.mjs`, `capabilities.mjs`, `gui.mjs`, `uia-script.mjs`, `NexusRobot.java`, `procs.mjs`, `files.mjs`, `browser.mjs`, `egress-proxy.mjs`; `v3/actions.mjs` (добавлен только export); `nexus-gateway/src/catalog.mjs`.
4. `cd nexus-gateway` → `npx wrangler deploy` (меняется только каталог инструментов, логика OAuth/шлюза та же).
5. `node nexus-host\nexus.mjs` — создаётся `capabilities.json` с безопасными значениями; в окне строка `Capabilities (...): screen_capture=ON ui_read=ON gui_input=off process_control=off run_task=off browser=off`.

Откат (обязателен как вариант): Ctrl+C → вернуть файлы из `NEXUS-0.3.0-backup` → `npx wrangler deploy` из резервной `nexus-gateway` → `node nexus-host\nexus.mjs` 0.3.0 → новый чат ChatGPT. `capabilities.json` 0.3.0 не читает — вреда нет.

## Приёмка — НОВЫЙ чат ChatGPT (старый кэширует каталог), режим Always ask
Опасные группы включаются **по одной, только на время своей фазы**. Смена фазы = правка `capabilities.json` → Ctrl+C → `node nexus-host\nexus.mjs` (туннель перерегистрируется сам). Чат ChatGPT тот же.

**Фаза A — безопасные значения по умолчанию (ничего не включаем)**
| # | Запрос ChatGPT | PASS |
|---|---|---|
| A1 | `image_selftest`, назови цвета 4 квадратов | белый / синий / зелёный / красный. Иначе — блокер ImageContent, приёмку продолжаем |
| A2 | `open_app notepad` → `list_windows` → `focus_window` по pid Notepad | `focused:true` |
| A3 | `inspect_ui` и `window_info` Notepad, `capture_screen` | дерево и прямоугольники есть, снимок виден (если A1 прошёл) |
| A4 | `mouse_action` / `keyboard_action` / `browser_open` / `run_task` / `process_action` | все → `capability_disabled` |
| A5 | `list_processes`, `search_files`, `file_action copy`, затем `delete` | копия создана, удалённый файл в `.nexus-trash` |

**Фаза B — только `"gui_input": true`**
| # | Запрос ChatGPT | PASS |
|---|---|---|
| B1 | `keyboard_action text "Привет от NEXUS 0.4.0"` → `capture_screen` | текст в Блокноте |
| B2 | по `inspect_ui` клик `mouse_action` в центр пункта меню «Файл/File» → `capture_screen` → `keyboard_action keys "esc"` | меню открылось — координаты UIA ↔ мышь совпадают при твоём масштабе |
| B3 | `mouse_action click` в точку панели задач (низ экрана) | `target_not_allowed` |
| B4 | ты сам ставишь фокус на окно PowerShell/терминала → `keyboard_action text "dir"` | `focus_not_allowed`, в терминале ничего не появилось |
→ вернуть `"gui_input": false`.

**Фаза C — только `"process_control": true`**
| # | Запрос ChatGPT | PASS |
|---|---|---|
| C1 | `process_action close` Notepad | Блокнот спрашивает о сохранении — ты жмёшь «Не сохранять» |
| C2 | `process_action kill` по pid explorer или PowerShell | `process_not_allowed` |
→ вернуть `false`.

**Фаза D — только `"browser": true`**
| # | Запрос ChatGPT | PASS |
|---|---|---|
| D1 | `browser_open https://example.com` → `browser_snapshot` → `browser_action click` по ссылке | новый URL; отдельное окно Edge без твоих вкладок и входов |
| D2 | `browser_open http://127.0.0.1:8765/mcp` | `url_not_allowed` |
| D3 | `browser_open http://127.0.0.1.nip.io/` (публичное DNS-имя → 127.0.0.1) | `egress_denied_private_destination` / `navigation_blocked` — сетевой уровень |
| D4 | `browser_open http://192.168.1.1.nip.io/` | то же |
→ вернуть `false`.

**Фаза E — только `"run_task": true` и задача `"tasks": {"whoami": {"exe": "C:\\Windows\\System32\\whoami.exe"}}`**
| # | Запрос ChatGPT | PASS |
|---|---|---|
| E1 | `task_status` → `run_task whoami` → `task_status id` | вывод `<компьютер>\<пользователь>` |
| E2 | `run_task` с несуществующим именем | `unknown_task` |
→ вернуть `"run_task": false`, задачу можно оставить или удалить.

**Завершение**
| # | Запрос ChatGPT | PASS |
|---|---|---|
| F1 | `read_audit_log lines 50` | все вызовы видны; введённый текст записан только длиной |
| F2 | окно Host после последнего перезапуска | `gui_input=off process_control=off run_task=off browser=off` |

Дальше включаешь только то, что нужно для конкретной работы, и выключаешь после.

## Проверено автоматически (CI, GitHub-hosted Windows Server + Ubuntu)
- Java 17 Temurin Robot: снимок, мышь, клавиши, отказ `win`/вне экрана/неизвестных команд.
- Windows PowerShell 5.1 UIA: `window_info`, `inspect_ui`, `focus_window` **переключил фокус между двумя Notepad через AppActivate(pid) и подтвердил через UIA**, `keyboard_action` (кириллица через буфер, заголовок стал `*Untitled`), `mouse_action` внутри Notepad — выполнен, вне его — `target_not_allowed`.
- Реальный Edge (Windows) и Chrome (Linux) по CDP: открытие, snapshot, ввод, клик, отказ для password, file:, javascript:.
- Сетевая защита браузера (`egress-proxy.mjs`): весь трафик браузера идёт через локальный прокси, который сам резолвит DNS один раз, отказывает, если ЛЮБОЙ адрес непубличный, и соединяется именно с проверенным IP. Реальный браузер: редиректы на 127.0.0.1 / localhost / имя→127.0.0.1, прямой переход по такому имени, fetch/img со страницы к loopback — **ни одного запроса до «приватного» сервера** (счётчик = 0). QUIC выключен, WebRTC только через прокси, loopback не обходит прокси.
- Каталог шлюза побайтно совпадает с каталогом Host; официальный MCP Python SDK видит 25 инструментов.

## Не проверено (только в приёмке на твоём ПК)
- Принимает ли ChatGPT изображения из MCP (`image_selftest`, `capture_screen`).
- Масштабирование >100 % (на раннере 100 %); проверка — шаг 4.
- Поведение фокуса у фонового Host на твоём ПК (на раннере сработало), Notepad Win11 (на раннере классический), Calculator (UWP).
- Время ответа через шлюз: холодный старт Java ≈ 5 с (прогрев при запуске Host).
