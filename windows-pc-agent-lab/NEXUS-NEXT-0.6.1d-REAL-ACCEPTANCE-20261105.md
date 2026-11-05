# NEXUS 0.6.1d — установка и реальная приёмка на Windows (05.11.2026)

## Статус

**УСТАНОВКА PASS / ПРИЁМКА ЧАСТИЧНАЯ: NX-19 PASS, NX-13 FAIL, NX-21 GUARD PASS + FULL E2E BLOCKED.**
Обнаруженный NX-13 отказал безопасно: запросил согласие вместо закрытия всплывающей панели, окно Edge не закрылось. Это функциональный FAIL, не подтверждённая критическая регрессия безопасности. Автоматический откат не выполнялся; Host остаётся доступным.

## Происхождение и процедура

- Разрешение владельца: «Разрешаю установку 0.6.1d по ACTIVATE-NEXT-0.6.1d c коммита ba9689d4».
- **Immutable code SHA**: `ba9689d4eee5c2a9d83e67475dd405eabdf39119`; ветка `experiment/nexus-0.6.1d-20261105`; ACTIVATE и документы на `a0dc4bd` до приёмки.
- CI [42072599361](https://github.com/entoni441-prog/mcp-android/actions/runs/42072599361): Windows/Linux/Gateway 3/3 PASS.
- Бэкап 5 старых runtime файлов: `C:\Users\krado\Documents\NEXUS\_backup-0.6.1d-clean-pre-20261105T175130Z`; исходные и резервные SHA256 и размеры совпали 5/5.
- Установщик: `C:\Users\krado\Documents\NEXUS\_activate-0.6.1d-20261105.mjs`; журнал: `_activate-0.6.1d-20261105-state.json`, фаза `installed_verified`.
- Остановлены только supervisor PID `3540` и Host PID `7528` без `/t`; заменены ровно `consent.mjs`, `uia-script.mjs`, `windows.mjs`, `apps.mjs`, `procs.mjs`. Existing task `NEXUS-Host-Run` запущена, конфигурация Планировщика не изменялась.
- После установки: Host PID `21788`, supervisor PID `10212`, локальный health PASS, внешний Gateway HTTP 200 / MCP Host online. Все пять установленных SHA256 независимо повторно сверены: **5/5 PASS**.
- `main`, Gateway, `discover.mjs` (NX-03), `runner.mjs`, `power`, политики и owner consent/security не изменялись.

## NX-19 — PASS

- NEXUS `open_app({app:'explorer'})` создал окно «Главная — проводник».
- `list_windows(includeTitles=true)` обнаружил `explorer` PID `6692` с заголовком окна.
- `close_window` закрыл только созданное NEXUS окно: `{closed:true,by:'nexus_owned'}`; повторный `list_windows` показал, что окна Explorer нет, остальные окна не тронуты.

## NX-21 — защита PASS, полный E2E BLOCKED

- До теста процессов Steam было **0**. Первый `open_app(steam)` запустил PID `8292`, первоначально вернул `createdByNexus.windows=['Steam']`.
- Фактическая цепочка Windows CIM: `steam.exe` PID `18008` ← PID `8292`; `steamwebhelper.exe` PID `8876` ← `steam.exe` PID `18008`; остальные webhelper — дочерние PID `8876`.
- Окно «Войти в Steam» — `steamwebhelper` PID `8876`; текущий `list_processes` возвращал `ownedByNexus:false` для Steam/helper, то есть NEXUS **не присвоил чужое/неустановленное окно**.
- Повторный `open_app(steam)` (новый launch PID `22180`) вернул `createdByNexus.windows=[]`: уже существующее окно не захвачено.
- Отрицательный тест `close_window` на «Войти в Steam» вернул `consent_required`; запрос немедленно отменён `confirm_action(cancel)`. Чужое окно не закрыто.
- Ограничение: ранее **владельцем** запущенного Steam в трее до теста не было; отдельный сценарий реального делегирования в сессию владельца не воспроизведён. Steam просит логин; авторизация не выполнялась. По этой части **BLOCKED**, не PASS.

## NX-13 — FAIL (реальная панель Edge Translate)

- Отдельный NEXUS Edge-профиль открыл французскую Wikipedia; появилось native окно перевода с названием **«Перевести страницу с французский?»**.
- `inspect_ui(pid=2012,maxDepth=8)` подтвердил кнопку `Закрыть` (`Button`, `ImageButton`, прямоугольник `x=772..796,y=98..122`) в дереве translate bubble `Chrome_WidgetWin_1`, через вложенные `BubbleFrameView` и `NonClientView`.
- `mouse_action({action:'click',x:783,y:109})` **не закрыл панель**: вернул `consent_required` для полного окна `msedge: окно «Wikipédia — Wikipédia — Личный: Microsoft Edge»` (audit event `via=click:Закрыть`, trace `ae85651303124be7`).
- Consent ID `fc7f8bc56e76` отменён (`confirm_action(cancel)`), действия закрытия не выполнялись. Основное окно Edge осталось открытым.
- Вероятная причина: `consent.mjs` строки 70–77 разрешают dismiss только при **непосредственном** `at.parent.className === 'Chrome_WidgetWin_1'` и ненулевом отдельном `at.parent.hwnd`; у реальной панели кнопку окружает вложенная UIA-иерархия. Требуется подтвердить реальный `uia-script` result `at.parent` без произвольного ослабления fail-closed.
- Для Claude: проверить UIA-предка popover (строго распознанное имя и отдельный HWND), сохранить запрет на закрытие основного окна/вкладок. Добавить регрессионный тест с реальной вложенной структурой Edge Translate. **Не исправлять прямо на установленном Host**.

## Решение и следующие действия

- Host доступен, supervisor восстановлен, критического нарушения owner consent не выявлено; **откат пока не требуется**.
- NX-13: `FAIL`, нужен отдельный исправительный коммит, CI, независимое ревью и разрешение на повторную установку.
- NX-21: `PARTIAL/BLOCKED` в непроверенном сценарии Steam владельца; недостающую реальную проверку проводить адресно с сохранением чужого окна.
- NX-03 / NX-26 не входят в сборку 0.6.1d, PASS им не присваивать.
- Не повторять уже завершённые проверки NX-19, SHA, CI или C.5 без причины. Никаких изменений production/main/Gateway/power/security.
