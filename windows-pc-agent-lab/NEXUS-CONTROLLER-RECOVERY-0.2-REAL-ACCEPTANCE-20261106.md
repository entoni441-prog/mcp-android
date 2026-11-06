# NEXUS Codex Task Auto-Resume 0.2 — независимый Supervisor, реальная приёмка

**Дата:** 06.11.2026 UTC (Europe/Rome UTC+1).
**Вердикт:** `CONTROLLER_CRASH_AUTO_RESUME = REAL PASS`; `PRODUCTION_DEPLOYMENT = NOT DONE`.
**Репозиторий:** `entoni441-prog/mcp-android`.
**База:** `2681d7776710f5eec11e28cb5efe364d16b23656` — ранее принятый реальный Codex CLI child auto-resume.
**Ветка:** `experiment/nexus-codex-controller-recovery-20261106`, без изменения `main`.

## Цель и границы

Выполнить отдельный экспериментальный контроллер над существующим Codex Auto-Resume: при аварийном завершении **самого controller Node** его независимый supervisor должен проверить PID/создание процессов, дождаться прекращения ранее запущенного Codex CLI и **возобновить исходную сессию по точному UUID** только в разрешённой, идемпотентной задаче.

Область разработки — `windows-pc-agent-lab/nexus-codex-autoresume/`. **Не изменяли** работающий NEXUS Host, Cloudflare Gateway, туннель, production, Windows Task Scheduler, `main`, политики безопасности, owner bans, `power`, установленный Codex или авторизацию. Ни одна тестовая команда не воздействовала на внешние сервисы, платежи или пользовательские чаты.

## Архитектура Auto-Resume 0.2

- **`supervisor.mjs run <manifest.json>`:** независимый отдельный Node-процесс, один явным образом разрешённый манифест, внутренний запуск `controller.mjs run`. Не запускается службой; оператор запускает его для одной конкретной задачи.
- **`lifecycle.mjs`:** read-only идентификация PID по исполняемому файлу и времени создания через Windows CIM или Linux /proc, безопасный `exited()`, атомарная запись состояния. Исправлена обработка и закрытие файлового дескриптора fsync на Windows.
- **`controller.mjs recover`:** допущен только от подтверждённого собственного supervisor через отдельный claim и inherited IPC; проверяет `taskId`, digest манифеста, исходный UUIDv7, безопасность операции, установленный бинарный SHA-256, Git-ветку, owner STOP и отсутствие прежнего активного child. Бюджет auto-resume — строго один, резервируется до запуска; `--last` не используется. Запуск начального prompt после аварии невозможен.
- **Эксклюзивность:** постоянные `supervisor-owner.json` и `owner.json`, отдельные `supervisor.json` и `state.json` в выделенной тестовой папке вне Git. Повторные/неизвестные состояния — STOP. Процессы из внешнего PID списка не завершаются: supervisor ждёт естественного завершения orphan либо останавливается по deadline.
- **Owner STOP:** запрещает новое выполнение; ограничения owner остаются. Полноценный recovery самого supervisor после его собственной аварии **не реализован** и не заявляется.

## Фактический ход испытаний

### 1. Разработка и тесты

- Codex из установленного приложения разработал `supervisor.mjs`, `lifecycle.mjs`, `supervisor.test.mjs` и согласованные изменения controller, fake Codex, README.
- Из sandbox Codex Windows CIM возвращал `0x80041003` — отказ в доступе; политики доступа **не меняли**. Через самостоятельные NEXUS Windows tools приёмка `identity()` дала PASS.
- При независимой проверке найден boundary FAIL: при завершении времени испытания supervisor иногда возвращал устаревший `CHILD_STARTED`. Это устранено с `timeExpired` и запретом запуска recovery при недостаточном времени; адресный тест `active orphan deadline STOP` прошёл.
- Полный независимый локальный прогон из NEXUS Node 24: **37 tests = 36 PASS, 0 FAIL, 1 SKIP**. Пропущен только негативный тест намеренного отсутствия доступа к process identity (на данном Windows доступ есть). Тесты охватывают реальный SIGKILL тестового controller, orphan wait, точный UUID, отсутствие повторного эффекта, owner STOP, хеш/ветку, несоответствие манифеста, ложный checkpoint, exhausted budget, deadline и нормальное завершение.
- `git diff --cached --check` — PASS; исходники сохранены исключительно в экспериментальной ветке. Исправлены BOM/CRLF в новых файлах и fsync FileHandle cleanup.

### 2. Первая попытка реального Codex CLI — корректный STOP, не PASS

- В отдельном `%TEMP%\nexus-controller-live-ZFlm0r` запущен supervisor с реальным встроенным `codex.exe`.
- Из-за короткого ожидания worker Codex завершил исходный ход **до внешней аварийной инъекции**, `state=STOP`, `reason=COMPLETION_UNCONFIRMED`, исходный эффект сохранился, `complete.json` отсутствует.
- Инъекция по PID не выполнена: скрипт preflight получил `WRONG_STATE` и отказал в воздействии. Никакого несанкционированного повтора, изменения настроек или использования того же checkpoint не было.
- Для последующей попытки подготовлен **новый** пустой Temp sandbox и отдельный одноразовый PID-watcher с проверкой всех предусловий и временной привязкой к checkpoint. Предыдущая папка сохранена для анализа, не переиспользовалась.

### 3. Настоящий SIGKILL controller при работающем Codex CLI — **REAL PASS**

Испытание во второй отдельной папке `%TEMP%\nexus-controller-live-L1V4f1`:

1. Подняты реальные независимые процессы: supervisor PID **19488**, собственный controller PID **4396**, созданный им Codex CLI PID **22992**, и тестовый Node worker PID **22852**.
2. Через Codex CLI в `02:51:53.537Z` созданы `checkpoint.json` и **единственный** `effect-once.txt` (`taskId=nx-supervisor-real-20261106`). Из stdout Codex сохранён реальный UUIDv7 `01a1aec4-fbdc-7cf1-a0c2-a63d33101052` в атомарном `state.json`.
3. Независимый одноразовый watcher PID **16516** сначала сверил точные пути процессов, PID, родительские PID, UTC-время создания, UUIDv7, окно исполнения, checkpoint, файл единственного эффекта и отсутствие owner STOP. Не читались и не выводились токены.
4. В `2026-11-06T02:51:54.541Z` watcher отправил **SIGKILL только verified controller PID 4396**; `controllerGone=true`. NEXUS Host, supervisor и пользовательские приложения не завершались. Зафиксирован до аварии SHA-256 эффекта `3f6b5645c2157880a348728e5cc8d5f1e35892179a901e631dcaefbd055d27f9`.
5. Supervisor самостоятельно обнаружил сбой и восстановил ту же Codex сессию: новый controller PID **22108**, новый Codex CLI PID **5560**, `attempt=1`, исходный UUID неизменен. **Никакого нового сообщения пользователя / повторного начального prompt** не было.
6. Codex выполнил завершающую операцию с проверкой исходного эффекта, создал `complete.json` в `02:52:05.047Z`. `state.json`: `status=COMPLETED`, `reason=COMPLETION_MARKER`, `recordedStatus=turn.completed`, UTC `02:52:18.595Z`. `supervisor.json` тоже `COMPLETED`.
7. Непосредственный NEXUS `run_command` ID `c-b1c29fa800` завершился `exitCode=0` с `{"status":"COMPLETED","reason":"COMPLETION_MARKER"}`.
8. Независимое содержимое и SHA:
   - `checkpoint.json`: задача/стадия/старый worker PID 22852, SHA `33489e8135ece8a481abd86938f49feeb45dfda02a58486cfa0f37d6c3b9ca15`.
   - `effect-once.txt`: **одна строка**, 42 байта; SHA **после** сбоя `3f6b5645c2157880a348728e5cc8d5f1e35892179a901e631dcaefbd055d27f9`, строго совпал с записью watcher **до** SIGKILL. Второго эффекта нет.
   - `complete.json`: `{"taskId":"nx-supervisor-real-20261106","status":"completed"}`, SHA `378ebff271275850922422b6a2118095c576503cb77bd761e0257dc2c3cbfa26`.
9. Постпроверка по точным PID **4396, 22992, 22852, 22108, 5560, 19488, 16516**: все семь остановлены, незакрытых тестовых процессов нет. Весь watchdog и state остался только в изолированном Temp, не публиковался в репозитории.

## GitHub / CI

- Код и bounded mock тесты: `ddbcdc4`.
- Расширенное окно реальной инъекции: `1383569`.
- CI workflow только экспериментальной ветки: `.github/workflows/nexus-controller-recovery-ci.yml`, `contents:read`, Node 24, Windows/Linux; коммит `eb99254`.
- Запуск GitHub Actions: [42153370813](https://github.com/entoni441-prog/mcp-android/actions/runs/42153370813).
- Первоначальный run [42153370813](https://github.com/entoni441-prog/mcp-android/actions/runs/42153370813): Ubuntu SUCCESS, Windows FAILURE (два тестовых `checkpoint timeout` при лимите ожидания 10 с; не было зафиксировано нарушения инвариантов контроллера).\n- Адресное исправление только тестовой инфраструктуры, **без изменений контроллера**: коммит `cbee95a` увеличил ограниченное время ожидания чекпоинта/общий timeout тестов и сериализовал наборы CI.\n- Повторная проверка: [run 42153867962](https://github.com/entoni441-prog/mcp-android/actions/runs/42153867962) — **Controller recovery (windows-latest) SUCCESS; Controller recovery (ubuntu-latest) SUCCESS; 2/2 PASS**.

## Сохранность и открытые ограничения

Проверено после испытания: **Host PID 23324 Online**, Gateway HTTP **200**, tunnel alive, `pendingConsents=0`. Локальный Git чист перед документированием. `power` остаётся запретом владельца. Никакого развертывания в существующий Host или включения автозапуска Windows.

**Принято:** экспериментальная цепочка `NEXUS → Supervisor 0.2 → Controller → Codex CLI` пережила реальный SIGKILL самого контроллера и завершила тестовую задачу с неизменным checkpoint UUID и без повторения синтетического эффекта.

**Не утверждается:** восстановление самого независимого supervisor после его падения, восстановление GUI-переписки Codex Desktop, exactly-once для произвольных внешних API, долгосрочный unattended, установка в production. Перед реальной интеграцией NEXUS требуется отдельный rollout с правами владельца, process-liveness и rollback plan. Рабочую систему не менять только ради этого эксперимента.
