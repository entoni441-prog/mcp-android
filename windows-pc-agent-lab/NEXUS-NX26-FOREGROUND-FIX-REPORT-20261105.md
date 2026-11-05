# NEXUS NEXT — NX-26 точная диагностика перекрытого окна

**Дата:** 05.11.2026. **Текущий результат:** CODE PATCHED / REAL WINDOWS READ-ONLY E2E PASS / CI 3/3 PASS / INSTALLED HOST UNCHANGED.

## Чекпоинты

- Исходная реальная диагностика: `93c96e396da6f38b78c0c025b46b8a00cb663671`, файл `NEXUS-NX26-FOREGROUND-REAL-DIAGNOSTIC-20261105.md`.
- Адресное исправление NX-26: **`2f805483e9fef540464a457035b562d1fc678b9d`**, отдельная ветка `experiment/nexus-nx26-focus-20261105`.
- CI: [GitHub Actions № 42125918824](https://github.com/entoni441-prog/mcp-android/actions/runs/42125918824) на указанном immutable SHA. **Windows PASS, Linux PASS, Gateway PASS (3/3 завершены успешно)**.
- **Манифест потенциальной установки:** `MANIFEST-NX26-FOCUS-20261105.sha256` — ровно 2 runtime-файла, проверено по immutable коммиту: `gui.mjs` `cc41e304af9757ccda180f71099e9c12ba41f969616e7f37570c9ee9d9fb361f`; `uia-script.mjs` `7384a1e8edb8762cf4ec540f5602a8a5696f15a1f94b5b504746475df53011aa`. Не означает разрешения на установку.
- Только `nexus-host/gui.mjs`, `nexus-host/uia-script.mjs`, `nexus-host/gui.test.mjs` и CI-триггер новой ветки. Установленный Host, Gateway, `main`, NX-03, NX-13/19/21, `power` и owner security не менялись.

## Причина и адресное исправление

До исправления `focusWindowInner` возвращал `foreground_lock_likely` при неудачном `AppActivate`/UIA и трёх недоступных точках заголовка, без различения перекрытого окна и блокировки фокуса ОС.

Теперь:
1. В ходе уже существующего **чтения** `UIA.FromPoint` у трёх точек заголовка дополнительно выполняется **только по запросу focus-проверки** нативный Win32 `WindowFromPoint` + `GetAncestor(GA_ROOT)` + `GetWindowThreadProcessId`.
2. `titlebar_occluded` допускается **только если** каждая из как минимум двух проверенных точек имеет чужой оконный HWND, оба независимых способа дают одинаковые HWND и PID, PID соответствует элементу UIA, точка находится на экране и не принадлежит target HWND.
3. Возвращаются `occlusion.verified=true`, число подтверждённых точек, HWND/PID/process перекрывающих окон; без пользовательского текста/заголовков.
4. При ошибке нативного вызова, различии UIA и Win32, неполной доказательной базе или недоступном заголовке — `titlebar_not_reachable` (не ложный `foreground_lock_likely`). `foreground_lock_likely` после безопасного клика, не изменившего foreground, сохраняется.
5. Существующий разрешённый titlebar fallback, проверка принадлежности точки, защита чужих/системных окон и owner consent **не менялись**. При перекрытии никакие клики по чужому окну не производятся.

## Тесты

- `node --test gui.test.mjs`: **25 PASS / 0 FAIL**. Новые тесты: реальная по структуре цепочка `charmap` под `msinfo32`, отсутствие кликов, строгая сходимость UIA/Win32, сбои и расхождения, сохранность fallback.
- `node --test consent.test.mjs windows.test.mjs stage2-052.test.mjs policy.test.mjs r01-052.test.mjs`: **63 PASS / 0 FAIL / 1 SKIP** (SKIP — существующий real-GUI Windows/Notepad, не считать PASS).
- `node --check gui.mjs`, `node --check uia-script.mjs`, `git diff --check`: PASS.
- **Реальный Win32/UIA на ПК:** native hit-test независимо совпал с UIA по HWND и PID; Windows 150% DPI: настоящие charmap PID **22716**, HWND **264590**, UIA rect `x=23,y=95,w=735,h=638`. Большое msinfo32 PID **21172**, HWND **1705066** поверх него. Все три целевые точки **(479,105), (391,105), (574,105)** в UIA-физических координатах вернули `msinfo32` PID 21172 HWND 1705066 через **оба** источника.
- **Реальная интеграция экспериментального `createGui.focusWindowInner`** на этом перекрытии: `focused=false`, `cause=titlebar_occluded`, `occlusion={verified:true,probes:3,blockedBy:[{hwnd:1705066,pid:21172,process:'msinfo32'}]}`. `UIA.SetFocus`: `MethodInvocationException`; `AppActivate` foreground не сменил; три `titlebar_probe` confirmed. Робот введён только как **защитная заглушка** (возвращал геометрию и запрещал любые клики), поэтому input не отправлялся.
- Тестовые окна `charmap` и `msinfo32` закрыты как `nexus_owned`, другие окна и процессы владельца не закрывались.

## Риски и границы

- Патч находится **только** в экспериментальной ветке. Реальный Host по SHA-256 всё ещё использует старые `gui.mjs` и `uia-script.mjs`; установка и новая live-приёмка через штатный Host требуют отдельного разрешения.
- Сценарий `Control Panel/csrss` остаётся ограничен системной политикой и **не принимался**. Не обходить `HARD_DENY`, не менять безопасность.
- Если `WindowFromPoint` возвращает неполные/несовпадающие данные (в том числе из-за DPI или смены Z-order), классификатор сохраняет безопасный неопределённый результат; не выдаёт ложный PASS или разрешение на ввод.
- Цель исправления — точная **диагностика**; изменение существующего алгоритма безопасной активации окна не выполнялось.
