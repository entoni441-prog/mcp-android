# NEXUS NEXT 0.6.1c — адресная приёмка на реальном Windows (05.11.2026)

**Базовый чекпоинт:** `a426dbef304fa3f5ec2c5f08b41937851a42861a` (`NEXUS-NEXT-0.6.1c-INSTALL-REPORT.md`).  
**Ветка отчёта:** `experiment/nexus-0.5.2-owner-access-20261102`.  
**Область:** только NX-052-03, NX-052-13, NX-052-19, NX-052-21, NX-052-26; без повторения PASS C.5, ZIP extraction, downloads, кириллицы. **Не менялись** рабочие файлы Host/Gateway, production, политики безопасности, capabilities, power.

## Соединение / предусловия
- `get_status`, `get_capabilities`, `host_diagnostics` ответили; в текущей сессии 42 доступных инструмента NEXUS (внутренний live_frame не представлен как вызываемый tool).
- `connection_status` 2026-11-05 08:22:49 UTC: `verdict:online`, `host:reachable`, gateway OK, probe HTTP **200 / 210 ms**, tunnel reconnects **0 / 15m**, verdict OK.
- Host: `version:0.6.1-next`, PID **7528** — ожидаемая строка версии в установленной **0.6.1c** согласно install report; supervisor и самовосстановление повторно не тестировались.
- `get_capabilities`: `gui_input,browser,commands,live_view,process_control` = true; `power:false`, `ownerBans:["power"]`; `fileError:null`. В начале `pendingConsents:0`.
- Live View инициирован через `watch_nexus` перед GUI; 34 кадра. Сессия Windows: `quser` console ID 1, `Active`, `logonUi:false`, `lockApp:false`.

## Матрица результатов
| Кейс | Итог | Подтверждённый факт |
|---|---|---|
| NX-052-03 ChatGPT open_app | **FAIL** | `open_app({"app":"chatgpt"})` -> `app_not_found`, хотя окно ChatGPT существует, UIA читает его |
| NX-052-13 Edge Translate popup | **FAIL** | Клик на **Закрыть** в bubble переводчика ошибочно требует согласия на закрытие **всего окна Edge** |
| NX-052-19 Explorer после ZIP | **PARTIAL / FAIL enumerator** | Explorer открывается и закрывается как NEXUS-owned, но `list_windows` его не перечисляет; сам ZIP повторно не распакован |
| NX-052-21 Steam / PWA PID mapping | **FAIL** | Steam launcher PID ≠ GUI helper PID, `createdByNexus.windows=[]`; даже закрытие запущенного нами Steam требует owner consent |
| NX-052-26 msinfo32 focus / UIA | **FAIL focus / PASS UIA** | Окно и 10 элементов UIA видны, но `focus_window` не может активировать его |

## NX-052-03 — App Discovery
**Шаги:** `manage_app_access({"action":"list"})` -> 31 установленное приложение, ChatGPT отсутствует. При этом `list_windows(includeTitles:true)` -> `ChatGPT`, PID **15208**. `open_app({"app":"chatgpt"})` -> **`app_not_found: see manage_app_access list`**, trace `069b6791766a5864`. `window_info(pid:15208)` -> окно `Chrome_WidgetWin_1`; `inspect_ui(pid:15208)` -> дерево UIA читается. **Предположение:** неполный индекс Start/apps для ChatGPT при рабочем распознавании процесса и окна.

**Дополнительный дефект классификатора команд:** диагностическая (read-only) PowerShell-команда с `Get-CimInstance`, `Get-StartApps`, `Format-List` без попыток записи классифицирована `destructive_command (R3: boot_or_disk_destruction)`; `run_command` вернул `consent_required` вместо исполнения. Trace `091b776658da3ae4`, consent `ddde74e452b5`. Возможная ложная эвристика на слово `Format-List`. Согласие НЕ подтверждено, команда НЕ исполнялась.

## NX-052-13 — Edge translator bubble
Открыта отдельная NEXUS-профиль Edge-страница `https://fr.wikipedia.org/wiki/Paris`, затем `browser_action navigate` -> `https://de.wikipedia.org/wiki/Berlin`. На немецкой странице `inspect_ui(pid:16364,maxDepth:8)` обнаружил внутри Edge **`Перевести страницу с немецкий?`**, pane класса `Chrome_WidgetWin_1`, кнопка `Закрыть` прямоугольник x772–796 / y98–122. 
`mouse_action({"action":"click","x":784,"y":109})` вернул **`consent_required` kind `window`**, target `msedge: окно «Berlin – Wikipedia — Личный: Microsoft Edge»`, trace `6c65ac23f0efc82f`; журнал: `via:"click:Закрыть"`. Это ложная классификация закрытия дочернего переводчика как закрытия целого browser window (вдобавок NEXUS-owned). Согласие **не подтверждено**. Первая попытка на том же экранном x/y ранее попала в `claude`, потому что Edge был перекрыт — проверить z-order/foreground до решения по hit-test.

## NX-052-19 — Explorer provenance / visibility
В workspace сохранилась ранее распакованная папка `NEXUS-test/zip-test-20261102` (`alpha`, `alpha.txt`, `beta.txt`); **повторная распаковка не выполнялась**. `open_app({"app":"explorer"})` -> `createdByNexus.windows:["Главная — проводник"]`, `tabs:["Главная"]`, trace `223f977bb146a12e`.
`list_processes(nameFilter:"explorer")` -> PID **6692**, `ownedByNexus:false` (Explorer — уже существующий shell процесс). `window_info(pid:6692)` видит `CabinetWClass` окно **«Главная — проводник»**, однако **`list_windows(includeTitles:true)` не содержит Explorer**, повторно. `focus_window(pid:6692)` -> success через titlebar fallback, `UIA.SetFocus` бросил `MethodInvocationException`. Попытка навигации в старую папку через Ctrl+L/ввод/Enter не подтверждена: после Enter `foregroundAfter:"csrss"`, заголовок остался «Главная — проводник». `close_window(pid:6692,title:"Главная — проводник")` -> `closed:true,by:"nexus_owned"` (trace `105eb3e76ca04319`). Следовательно, ownership окна/закрытия работает, **enumerator list_windows и/или переход к ZIP-derived окну не подтверждены**.

## NX-052-21 — Electron / Steam / PWA PID
До запуска Steam не работал. `open_app({"app":"steam"})` -> `started:true,pid:2460,createdByNexus.windows:[]`, trace `865205c64e7d166b`. `list_processes`: `steam.exe` PID **2460**; окно `Войти в Steam` принадлежит **`steamwebhelper.exe` PID 18656**, `SDL_app`, trace `e4a224b28b13c773`. `window_info(pid:2460)` -> `windows:[]`, `focus_window(pid:2460)` -> **`window_not_found`**, trace `1d0fcdaddc248c6f`; `focus_window(pid:18656)` -> `foreground_lock_likely`. `list_processes` помечает оба `ownedByNexus:false` несмотря на запуск `steam` через NEXUS. `process_action({"pid":2460,"action":"close"})` -> `consent_required` для Steam, trace `1b4aaed29504895f`; НЕ подтверждено. **Закрытие окна входа Steam не подтверждено: возможно, оно осталось открытым.** Никаких учётных данных не вводили.
Дополнительно существовавшая Grok PWA: `list_windows` -> `msedge` PID **1772**, окно **Grok**, `window_info` -> `Chrome_WidgetWin_1`, но `focus_window(pid:1772)` -> `focused:false,cause:"foreground_lock_likely",foregroundProcess:"csrss",foregroundHwnd:0`, trace `c076e83eda19b12e`. PWA отдельно не перезапускалась.

## NX-052-26 — msinfo32
`open_app({"app":"system-information"})` -> PID **2596**, `createdByNexus.windows:["Сведения о системе"]`. `list_windows` и `window_info` видят `msinfo32`, класс `#32770`, rect x50/y50/w1180/h620. `inspect_ui(maxDepth:4,maxNodes:100)` -> **10 узлов** (SysTreeView32, SysListView32, Edit, поиск, закрытие): UIA **PASS**. `focus_window(pid:2596)` -> `focused:false,method:"none",cause:"foreground_lock_likely",foregroundProcess:"csrss",foregroundHwnd:0`, `UIA.SetFocus -> MethodInvocationException`, titlebar fallback не сработал; trace `423742c1e853ac2b`. При этом `system_info(session)` подтвердил незаблокированную **Active** console. `close_window(pid:2596,title:"Сведения о системе")` -> `closed:true,by:"nexus_owned"`.

## Сквозные проблемы и гипотезы для Claude
1. **Start-menu registry/AppX/PWA discovery:** каталог `manage_app_access` не видит установленный/запущенный ChatGPT при валидном Win32-окне.
2. **Child bubble vs primary window ownership:** hit-test `click:Закрыть` ошибочно назначает owner-consent на primary Edge вместо локального popover. Нужно проверять `hwnd`, control ancestor и регистрацию NEXUS browser.
3. **Explorer:** `list_windows` исключает `CabinetWClass` при общем shell-процессе, хотя `window_info` видит его, `close_window` правильно использует ownership по title/tab.
4. **Steam:** запуск `steam.exe` PID 2460 порождает GUI у `steamwebhelper.exe` PID 18656; нужно сопоставлять дочерние GUI окна с launch и регистрировать `createdByNexus` после появления, не трактовать для cleanup как owner window/process.
5. **Focus:** `UIA.SetFocus+AppActivate` часто `MethodInvocationException`; резервный titlebar иногда помогает (Edge, Explorer), но `foregroundHwnd:0` / `csrss` у Steam/Grok/msinfo32 — исследовать input desktop, foreground permissions, z-order; не считать `focused` успешным без проверки.
6. **False-positive command guard:** PowerShell `Format-List` вероятно совпал с эвристикой разрушительного `format`; read-only command потребовала owner_phone.
7. **Task persistence:** Host audit `task_resumed` для `t-c50b5706164f` (`interruptedBy:host_restart`) произошёл автоматически при начале GUI-сессии, без отдельной явной команды resume. Проверить, ожидаемо ли поведение; `finish_task` в конце отметил `taskStatus:finished`.

## Завершение и безопасность
- Тестовые окно Explorer и msinfo32 закрыты через `close_window` с `by:nexus_owned`. Браузер был открыт в отдельном NEXUS-профиле; финальная `finish_task` вернула `active:false,taskStatus:"finished",sessionActive:false,liveActive:false`, но `ended:false` (вероятно сессия уже истекла); отдельное подтверждение закрытия Edge в этом ответе отсутствует.
- **Три** ожидавших подтверждения consent на момент 08:22:49 UTC: `ddde74e452b5` (read-only command), `3aafcf4ef44c` (Edge bubble), `19f03ddbb924` (Steam cleanup). **Ни одно не подтверждено и действие по ним не выполнялось**; они должны истечь по TTL, фактическое истечение не проверено.
- **НЕ вызывали** `power_action`, `set_capability`, security changes, производственные деплои, изменения main. Host и Gateway остались без изменений.
- Следующее действие: Claude исследует соответствующие функции в экспериментальной ветке, применяет адресные исправления и добавляет regression tests. Затем отдельная приёмка только FAIL, без повтора PASS.
