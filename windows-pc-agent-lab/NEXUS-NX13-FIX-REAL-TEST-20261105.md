# NEXUS 0.6.1d — NX-13 исправление и реальная диагностика (05.11.2026)

**Предыдущий checkpoint:** `7b1e9d6154197793ac89f737e06625b837273f0d`; документ реальной UIA-цепочки `NEXUS-NX13-EDGE-UIA-CHAIN-20261105.md`.

**Исправленный runtime-код:** `4cfc3603660fcfc70b3ccb5fca973af0b742d802` на экспериментальной ветке `experiment/nexus-0.6.1d-20261105`. Изменены только `nexus-host/consent.mjs`, `consent.test.mjs`, `gui.mjs`, `uia-script.mjs`. Production Host, Gateway, main, power, security не изменялись.

## Причина дефекта и исправление

- Исходный NX-13 ожидал непосредственного родителя кнопки `Chrome_WidgetWin_1`; настоящая UIA-цепочка содержит `BubbleFrameView`, `NonClientView`, `RootView`, только на глубине 4 — собственный `Chrome_WidgetWin_1` переводчика.
- Неудачная пробная интеграция внутри экспериментальной копии показала ошибку PowerShell: тип `[Nx13OwnerApi]` не найден из-за неявного пространства имён `Add-Type`. Изменено на явные `Add-Type -Namespace Nx13 -Name OwnerApi` и `[Nx13.OwnerApi]`.
- Теперь native-проверка ищет **первого** предка с ненулевым HWND не далее шести уровней; требует `Chrome_WidgetWin_1` с русским или английским названием панели перевода, HWND отличным от основного Edge, и Win32 `GetWindow(GW_OWNER)` / `GetAncestor(GA_ROOTOWNER)` точно равными HWND главного Edge. PID popup, главного окна и UIA-элемента совпадают.
- При любом отсутствии доказательства `nativeBubble` не появляется, `classifyClick` оставляет старое `consent_required`. Закрытие основного Edge не разрешается автоматически. После фактически посланного click журнал фиксирует оба HWND.

## Фактические тесты

- Локально `node --test consent.test.mjs windows.test.mjs stage2-052.test.mjs`: **38 PASS / 0 FAIL / 1 SKIP**, единственный SKIP — real GUI/Notepad, не отнесён к PASS.
- Отрицательные тесты: обычное `EdgeWindowsCaptionButton/view_7`, чужой `GW_OWNER` / `GA_ROOTOWNER`, чужой PID, неверный title/className, глубина более 6, неизвестный Win32-результат, modal dialog — все остаются gated.
- **Mutation sensitivity PASS:** временная модель без сравнения `ownerHwnd === main` пропустила чужой popup; базовый тест правильно отказал. Это подтверждает, что проверка владельца действительно критична.
- **Live Edge на Windows (без установки кода):** NEXUS открыл отдельный Edge-профиль на французской Wikipedia. Вызов нового `runUiaReal({mode:'at',x:1176,y:165})` из экспериментального модуля вернул `pid=20808`, `Button/ImageButton/Закрыть`, `nativeBubble.verified=true`, `depth=4`, `hwnd=592310`, `mainHwnd=264690`, `ownerHwnd=264690`, `rootOwnerHwnd=264690`, `pid=mainPid=20808`, `reason=edge_translate_win32_owner_verified`; `classifyClick('click',at) === null`. Это реальная интеграционная проверка UIA + Win32 + классификатора, не синтетический тест.
- Реальное **нажатие** через новый `mouse_action` установленного Host **не выполнялось**: новая сборка ещё не установлена. Отдельный тест после разрешённой установки обязателен; реальную кнопку закрытия всего Edge не нажимать.
- Git `diff --cached --check` PASS, только четыре изменённых файла; commit+push без force, рабочая копия чистая.

## CI и выпуск

GitHub Actions run: https://github.com/entoni441-prog/mcp-android/actions/runs/42100299119 на точном SHA `4cfc3603660fcfc70b3ccb5fca973af0b742d802`.

**CI VERIFIED: 3/3 PASS.** Run [42100299119](https://github.com/entoni441-prog/mcp-android/actions/runs/42100299119) on immutable code SHA `4cfc3603660fcfc70b3ccb5fca973af0b742d802`: Windows `success`, Linux `success`, Gateway `success`. Это не разрешение на установку.

**Установка не разрешена этим документом.** Работающий Host остаётся на предыдущих пяти runtime-файлах `ba9689d4`. Для новой установки требуется отдельно подготовить манифест/backup/ACTIVATE и получить разрешение владельца; затем реальная приёмка только NX-13.
