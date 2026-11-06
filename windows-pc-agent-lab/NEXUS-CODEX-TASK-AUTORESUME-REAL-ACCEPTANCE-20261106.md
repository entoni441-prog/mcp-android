# NEXUS — Codex Task Auto-Resume: экспериментальная разработка и реальная приёмка

**Дата:** 06.11.2026 UTC / Europe-Rome.
**Итог:** **CLI_CHILD_AUTO_RESUME = REAL PASS**; **DESKTOP_GUI_AUTO_RESUME = NOT FIXED / NOT PROVEN**.
**Статус:** проверенный экспериментальный модуль, **не установлен** как production service или фоновое задание Windows.

## Происхождение и изоляция

- Исходный доказанный чекпоинт: `e553559` (Codex Desktop crash: самопроизвольное продолжение FAIL; реальный Cloudflare failover PASS).
- Ветка: `experiment/nexus-codex-task-autoresume-20261106` от `e553559`. Нет изменений `main`, установленного NEXUS Host, Gateway, Cloudflare, Windows security, power, авторизации или существующих пользовательских приложений.
- ТЗ: `windows-pc-agent-lab/nexus-codex-autoresume/TASK.md`. Код, тесты и README — исключительно новая папка `nexus-codex-autoresume/`. CI — отдельный workflow только для экспериментальной ветки.
- Встроенный Codex CLI обнаружен в уже установленном Windows-пакете ChatGPT/Codex: версия **`0.166.0-alpha.6`**, команда `codex login status` → **Logged in using ChatGPT**. Без установки CLI и без чтения credential-файлов.
- Проверенный SHA-256 исполняемого CLI: `925c7d0665ffa49b0dcf748e034a805a04da984164ac92301432073b47789b99`. Контроллер требует точный файл и SHA, а не команду из PATH.

## Архитектура

Независимый `controller.mjs` запускает разрешённый конкретным JSON-манифестом `codex exec --json --sandbox workspace-write -C <repo> <prompt>`, сохраняет `thread.started.thread_id` (UUIDv7), PID дочернего CLI и checkpoint в отдельном каталоге. При подтверждённом ненулевом завершении **только собственного** дочернего CLI и отсутствии валидного completion-marker разрешён **один** `codex exec resume --json <exact-thread-id> <bounded-resume-prompt>`. Никакого `--last`, глобального rerun, `--yolo`, `--approve-for-me`, отключения песочницы или автоподтверждений.

Состояния: `CREATED` → `RUNNING` → `RECOVERING` → `COMPLETED` либо `STOP`. Отдельные `owner.json` claim, `state.json`, `completionFile` (в тестовом sandbox); атомарное сохранение state с best-effort fsync. Неверная Git-ветка, чужие изменения, несовпадение бинарного SHA, отсутствие ID, нехватка разрешений или неизвестное завершение → STOP. Права `power` не запрашивались. Owner STOP или таймаут завершают только собственный ChildProcess через его handle и записывают результат проверки закрытия.

## Test 1 — локальная независимая приёмка

- Codex CLI самостоятельно создал `controller.mjs`, `controller.test.mjs`, `fake-codex.mjs`, `README.md`; оператор независимо проверил код и тесты.
- Отдельно создан `pilot-worker.mjs` и тест, намеренно работающие только в изолированной тестовой папке в системном Temp (без внешних side effects).
- **21/21 локальных тестов PASS**, 0 FAIL, 0 SKIP, Node v24. Включают внешний SIGKILL точно идентифицированного mock-child, auto-resume прежнего UUID, один эффект, budget=1, fail-closed, owner STOP до и во время исполнения, таймаут с остановкой собственного child, неверный Git branch, SHA mismatch, секретный canary.
- GitHub Actions [run 42148827226](https://github.com/entoni441-prog/mcp-android/actions/runs/42148827226): **Windows SUCCESS / Ubuntu SUCCESS, 2/2 PASS**.

## Test 2 — реальная совместимость Codex CLI: обнаружен и исправлен дефект

- Первый реальный тест: `%TEMP%\nexus-codex-live-d0wkV5`, Codex PID `19156`, sandbox worker создал `checkpoint.json` и `effect-once.txt`. Код принимал только UUIDv1–v5, однако **реальный Codex генерирует UUIDv7** (см. официальный schema `ThreadStartResponse.json` в `openai/codex`). Поэтому threadId остался null; после завершения тестового worker контроллер корректно STOP с `reason=BAD_EVENTS`, без попытки угадать сессию или повторить эффект.
- Исправлено на `UUIDv1–v8` с проверкой RFC-варианта. Регрессионный fake Codex теперь генерирует UUIDv7. После исправления **21/21 PASS**.
- Первый тестовый sandbox оставлен как диагностический, без `complete.json`, без переиспользования.

## Test 3 — настоящий SIGKILL Codex CLI и автоматическое продолжение: **PASS**

Испытание проводится в **новом** `%TEMP%\nexus-codex-live-EeJKmW` (первый тестовый каталог не переиспользован).

1. Контроллер запущен через существующий NEXUS Windows connector один раз. Начальное состояние `RUNNING`; Codex CLI child PID **15772**. `thread.started` записан как настоящий UUIDv7 `01a1ae9b-f765-7751-8999-412e78f04e18` (сохранялся в `state.json` до сбоя).
2. Под управлением реального Codex CLI запущен ограниченный Node pilot worker PID **15944**. В `02:07:05.574Z` он записал `checkpoint.json` и ровно один `effect-once.txt` (`taskId=nx-cli-live-20261106`), затем ожидал.
3. Внешний NEXUS-оператор **до сигнала проверил** PID `15772` как именно дочерний `codex.exe` с точным установленным путём, аргументами `exec --json`, ранее сохранённым UUIDv7, ожидающим worker и test-only effect. После проверки целенаправленно выполнено `Stop-Process -Id 15772 -Force`. Возвращено `cliGone=true`. Не завершались Desktop, Host, cloudflared, supervisor, другие процессы и службы.
4. Контроллер независимо заметил exit собственного child, сохранил `RECOVERING` и **без повторного сообщения пользователя** запустил CLI child PID **20212**, вызвав `codex exec resume --json` с **тем же** UUIDv7.
5. Продолженная модель проверила исходный checkpoint/effect и выполнила только завершающую операцию; `complete.json` создан в `02:07:55.516Z`.
6. `state.json` финально: `status=COMPLETED`, `attempt=1`, `reason=COMPLETION_MARKER`, тот же threadId, `updatedAt=2026-11-06T02:07:59.002Z`. NEXUS command `c-7794fa81bf` завершён с **exit code 0**.
7. Независимая проверка файлов в test-only Temp:
   - `checkpoint.json`: `taskId=nx-cli-live-20261106`, `stage=awaiting_cli_crash`, PID `15944`, SHA-256 `474a5b5c3d332c6f966074d3af44300c540610040cd4c60a11ad8900f9d221f7`.
   - `effect-once.txt`: одна строка, 33 байта, SHA-256 **до и после** `785f41bd9c047493240d171b593bcdf339a6173ff58881f81d8bb1d0b31dcfec`; не перезаписан.
   - `complete.json`: `{"taskId":"nx-cli-live-20261106","status":"completed"}`, SHA-256 `a037eb4a002328c8c50ee772f370f2d25240391ac85dccb45731046b6a2baf2a`.
8. Нет второго начального запуска, лишней оплаты/подписки или произвольных изменений Git, security, Host/Gateway. Модель сохранила контекст сессии через CLI и выполнила завершение, поэтому тест засчитывается **REAL CLI AUTO-RESUME PASS**, в отличие от предыдущего mock-only.

## Защиты и ограничения

- **Не реализовано:** автоматическое восстановление конкретного *Desktop GUI thread* после падения приложения. Здесь использован отдельный поддерживаемый механизм Codex CLI с общей авторизацией ChatGPT. Не подменять один сценарий другим.
- **Не развернуто:** системная служба, планировщик, автозапуск после reboot, интеграция в production NEXUS, автоматическое восстановление **самого контроллера** при его crash. Экспериментальный controller восстанавливает только Codex CLI child при условии, что controller/Windows Host остаётся жив. После падения controller сохраняется claim, нужен отдельный безопасный rescue workflow.
- **Не гарантируется:** exactly-once во внешних системах. Подтверждён один синтетический локальный эффект; реальные необратимые действия требуют явных transaction/idempotency keys и проверки.
- При owner STOP/таймауте controller проверяет закрытие **собственного** child, но его вложенные процессы теоретически могут потребовать отдельной диагностики.
- Необходима явная авторизация манифеста и task scope; не использовать контроллер для непрерывного самостоятельного исполнения произвольных поручений без согласия.
- Код, CI и отчёт находятся только в экспериментальной Git-ветке, `main` и установленные компоненты не менялись.

## Заключение

**Устранён архитектурный пробел для конкретной headless CLI-задачи:** Codex может быть восстановлен по **точно сохранённой сессии** после реального SIGKILL и завершить действие без повторения подтверждённого эффекта.

Следующий архитектурный этап — привязка этого протокола к разрешённым задачам NEXUS, поддержка восстановления самого controller и, если понадобится, маппинг Desktop thread ID к CLI/app-server без повторной авторизации и без обхода согласий.
