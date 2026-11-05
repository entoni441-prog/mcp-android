# NX-26 — реальные тесты фокуса Windows (05.11.2026)

**Статус: DIAGNOSTIC PASS / FUNCTIONAL ISSUE REPRODUCED / CONTROL PANEL BLOCKED.** До теста: NX-21 FULL PASS, checkpoint `9f7e200`. NEXUS Host 0.6.1d с NX-13 hotfix установлен, Gateway доступен. Никакой код/production/security/power не менялись.

## Подготовка

- Владелец прямо попросил закрыть окно Steam. `close_window({pid:464,title:"Войти в Steam",ownerRequested:true,onUnsaved:"ask"})` → `closed:true,by:"owner_request",prompt:null`. После — Steam окон **0**, Steam процессов **0**.
- Включена трансляция экрана через `watch_nexus`: `state=active,granted=true,streaming=true`. Остальные пользовательские окна сохранены.

## Сценарий A — msinfo32

- `open_app({app:"msinfo32"})` → `app_not_found`: это имя не является зарегистрированным alias, **не** ошибка Win32.
- `manage_app_access({action:"list"})` показал реальный установленный alias `system-information` (ordinary). `open_app({app:"system-information"})` → `started:true,pid:9964,createdByNexus.windows=["Сведения о системе"]`.
- `window_info({pid:9964})`: `#32770`, rect `x=50,y=50,w=1180,h=620`, `foreground:false`.
- `focus_window({pid:9964})`: **`focused:true,method:"titlebar_click",hwnd:853450`**.
- Детали: `UIA.SetFocus+AppActivate` → `uiaSetFocus:false,setFocusError:"MethodInvocationException"`, `foregroundBefore:"explorer"`. Затем `titlebar_probe:ok=true,control:"Window"`; безопасный `titlebar_click` перевёл foreground в `msinfo32`.
- Повторные `window_info` и read-only Win32 `GetForegroundWindow/GetWindowThreadProcessId`: **HWND 853450, PID 9964, process msinfo32**. Фокус подтверждён независимо.

## Сценарий B — перекрытая «Таблица символов»

- `open_app({app:"calculator"})` → started, окно NEXUS `Калькулятор`. GUI host `ApplicationFrameHost PID 3788`; NEXUS `window_info` отказал `app_not_allowed: owner_handoff_required shell_ui`. Запрет не обходился.
- `open_app({app:"character-map"})` → started, создано `Таблица символов`, PID **16104**, HWND **591374**, rect `x=15,y=63,w=490,h=425`, `#32770`, `foreground:false`.
- При активном полном поверхностном окне msinfo32 `focus_window({pid:16104})` вернул **`focused:false,cause:"foreground_lock_likely"`**. Foreground оставался **msinfo32 HWND 853450**; `UIA.SetFocus` — MethodInvocationException, `titlebar_probe` — `ok:false,control:"Window"` 3 раза. По screenshot заголовок charmap был действительно перекрыт большим окном msinfo32.
- NEXUS штатно кликнул кнопку **свернуть** на принадлежащем ему msinfo32 `mouse_action({action:"click",x:1106,y:64})` → `done:true,target:msinfo32,foregroundAfter:"charmap"`.
- Контроль: `window_info({pid:16104})` → `foreground:true`, `window_info({pid:9964})` → `foreground:false,rect:null` (свёрнут). `focus_window({pid:16104})` → `focused:true,already:true,hwnd:591374`. Screenshot подтвердил видимое окно charmap.

## Классификация результатов

- **PASS**: открытие/распознавание msinfo32, Win32-проверка foreground, разрешённое восстановление фокуса через заголовок; charmap перешёл на передний план после устранения перекрытия.
- **FAIL (качество причины)**: `foreground_lock_likely` выставляется при реально перекрытом окне. Более точная гипотеза: `window_occluded/titlebar_not_reachable`, а не доказанная блокировка Windows foreground. Нужно добавить read-only hit-test/z-order, чтобы доказуемо различать эти случаи, **без кликов по чужим окнам**.
- **BLOCKED**: Control Panel/\`control\` относится к `HARD_DENY` политики NEXUS; системный `ApplicationFrameHost` отказал GUI-управлению. Не запускать Control Panel через произвольную команду или обход защиты. Сценарий `csrss` конкретно в этом прогоне не воспроизведён; причины через `csrss` **не подтверждены**.
- **CLEANUP**: `close_window` для NEXUS-owned charmap и msinfo32 → `closed:true,by:"nexus_owned"`. Закрытие NEXUS-owned Calculator через `ApplicationFrameHost PID 3788` возвращает `app_not_allowed ... shell_ui` (оставлен для штатного `finish_task`); это отдельный пункт cleanup, не успешное закрытие.

## Рекомендация для Claude

Не переделывать работающий titlebar fallback. Исправлять **только диагностическую классификацию NX-26**: различать `foreground_lock_likely`, недоступный из-за перекрытия заголовок и системную `shell_ui` границу; сохранять fail-closed и не переключать фокус чужих окон. Тестировать на данной реальной последовательности и на отрицательных примерах. Изменения runtime, Gateway, main и безопасности не разрешены этим протоколом.
