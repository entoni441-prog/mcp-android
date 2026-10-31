# Windows UI Automation — локальный read-only эксперимент (не v3)

**Статус:** первый изолированный прототип. Не агент удалённого управления, не служба, не MCP-клиент и не сетевой listener. Никогда не выполняет поступившие извне команды. Не меняет другие приложения и файлы.

## Что реализовано
- Единственная локальная команда `inspect-allowed-window.ps1` (Windows PowerShell 5.1, штатные UIAutomationClient/UIAutomationTypes; дополнительных библиотек не требуется).
- Только выбранный вручную **активный** Notepad или Calculator: проверяется действительное Win32 foreground HWND и имя процесса; на другие окна поиск по UI Automation не распространяется.
- Только прямые дочерние элементы целевого окна (максимум 24–40), ограниченная структура: `controlType`, нормализованный `automationId`, `isEnabled`. Никакие заголовки, тексты, значения или скриншоты не извлекаются.
- Пользователь обязан явно указать `-IApproveLocalInspection` при **каждом** локальном запуске. При отсутствии флага ответ `blocked/explicit_local_consent_required`, код 2.
- При неинтерактивной Windows, Session 0, другом активном окне, неподходящем приложении и ошибке UIA — безопасный отказ. Нет запуска программ, сетевого обмена, записи на диск, сохранения токенов или команд управления.
- 3 секунды после запуска для переключения фокуса из терминала на уже открытое целевое окно.

## Синтаксис пробного запуска (только пользователем локально, после согласия)
```powershell
powershell.exe -NoProfile -File .\windows-pc-agent-lab\ui-probe\inspect-allowed-window.ps1 -App notepad -IApproveLocalInspection
```
Сначала открыть Notepad без личных документов, затем выполнить команду и за три секунды сделать окно Notepad активным. Операция не удаляет и не изменяет данные. Без `-IApproveLocalInspection` скрипт откажет до открытия UIA. Пользователь не должен запускать скрипт ради проверки CI — GitHub Actions делает офлайн-проверки самостоятельно.

## Проверка
[GitHub Actions `windows-ui-probe-safety.yml`](https://github.com/entoni441-prog/mcp-android/actions/workflows/windows-ui-probe-safety.yml) использует Windows PowerShell parser, AST-аудит запрещённых команд и два негативных теста (без согласия; неподдерживаемое приложение). На GitHub-hosted Windows runner нет гарантированного интерактивного desktop-сеанса, поэтому фактическое чтение UIA под Windows **не подтверждается** CI.

## Не сделано, не заявлять как готовое
1. Прямая Windows UIA-проверка на реальном пользовательском компьютере.
2. Разрешённый `invoke_control`, readback или GUI-операции.
3. Безопасный transport, подписанный IPC и авторизация заявок из обычного чата.
4. Любой v3 Worker / polling client / SQL, ранее запрещённый к публикации. Этот UIA-прототип **не является** альтернативным каналом публикации заблокированных частей v3.

Модель угрози: приложение `notepad` или `CalculatorApp` может в разных сборках Windows использовать отличный процесс-хост; несовпадение приводит к отказу, не к сканированию по названию окна. Автоматизация требует разблокированного foreground-сеанса и не должна читать личные файлы.

## Документация API Microsoft
- [GetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow)
- [AutomationElement.FromHandle](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.fromhandle?view=netframework-4.8.1)
- [AutomationElement.FindAll](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.findall?view=windowsdesktop-10.0)

## Офлайн-контракт результата — 31.10.2026
Добавлены `validate-report.mjs` (строгая проверка схемы) и `validate-report-stdin.mjs` (строго ограниченный адаптер только stdin → stdout). Они **не осуществляют сетевого обмена**, не создают новые задачи, не пишут файлы, не читают личные данные и не предоставляют удалённое управление.

- Вход: одна строка JSON из локального PowerShell `inspect-allowed-window.ps1`, не более 16 КиБ. Допустимы только `ok/inspection_completed`, известные безопасные `blocked` и `error` статусы; приложение — `notepad` или `calculator`.
- При `ok`: до 40 элементов, только `controlType`, `automationId`, `isEnabled`; неизвестные поля, названия окон, тексты, значения, персональные данные, неподтверждённые статусы и неподходящие типы → ошибка `invalid_uia_report`.
- При `blocked/error`: допускается **только null** вместо метаданных, чтобы отказ не приводил к утечке.
- Проверка Windows CI: структурные негативные тесты (`node --test windows-pc-agent-lab/ui-probe/tests/validate-report.test.mjs`) плюс передача **реального PowerShell-отказа без согласия** в `validate-report-stdin.mjs`, где он заново проверяется.
- Контракт **не доказывает интеграцию** с Cloudflare. У Windows v2 нет интерфейса получения задач, сервер/клиент v3 были ранее заблокированы к публикации. Не использовать отдельный транспорт для обхода прежнего отказа.

**Приёмка этапов:** `LOCAL_SCHEMA_PASS` — после успешного CI; `LOCAL_UI_READBACK` — не подтверждено на реальном ПК; `CLOUD_TRANSPORT` и `CHAT_REMOTE_ACTION` — не реализованы.
