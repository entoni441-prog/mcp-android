# NEXUS → Codex → GitHub — сквозная приёмка 06.11.2026

**Статус: E2E PASS (экспериментальная разработка и публикация), ограниченный scope.**
**Проверенные ограничения:** без изменения установленного NEXUS Host, production Gateway, main, безопасности, питания и платных ресурсов.

## Исходная база и изоляция

- Репозиторий: `entoni441-prog/mcp-android`.
- Исходный подтверждённый чекпоинт: `a10895c1ddc3fa2b7472aee2934b56f926be77af` (NX-03 cold-start FULL PASS).
- Новая самостоятельная ветка: `experiment/nexus-codex-selftest-20261106`, создана от `a10895c` до разработки.
- Windows: `C:\Users\krado\Documents\NEXUS\_src-next-0.6.1d-clean`.
- NEXUS `get_capabilities`: `gui_input=true`, `commands=true`, `live_view=true`, `power=false`, `ownerBans=['power']`. Host PID `23324`; Gateway HTTP 200.
- С помощью `watch_nexus`, `open_app chatgpt`, GUI Windows и выбора локального Codex проекта NEXUS подключился к имеющемуся Codex desktop. Выбранный проект уже указывал на рабочую копию `_src-next-0.6.1d-clean`, новые установки не требовались.
- Создана отдельная Codex-тема «Выполни инженерную задачу NEXUS»; Codex выполнил локальную проверку `Get-Location`, `git status --porcelain=v1`, `git branch --show-current`, `git rev-parse HEAD` до изменения файлов.

## Поручение Codex

Разработать **только** новый, изолированный, некоммерческий и read-only модуль `windows-pc-agent-lab/nexus-selftest/`:
- `selftest.mjs`: чистая функция `evaluateNexusSnapshot(snapshot)` для NEXUS `connection_status`, `host_diagnostics`, `get_capabilities`. Фиксированные статусы `PASS/WARN/FAIL` и причины без копирования входных данных.
- `selftest.test.mjs`: тесты healthy, timeout/reconnect, Gateway offline, запрет power, pending consent, отсутствующие поля, некорректные значения и синтетический secret canary.
- `README.md`: контракт входных данных и инструкция `node --test`.
- Нельзя было менять `main`, установленный Host, Gateway, производственные экземпляры, секреты, политики, сетевые настройки, платежи; нельзя commit/push из самой Codex-сессии.

**Наблюдение:** интерфейс Codex показал `Изменено 3 файла +191 -0` и завершение задачи с заявленными `8/8 PASS`. Независимая проверка NEXUS показала ровно эти три файла и отсутствие других изменений перед действиями оператора.

## Независимая проверка на реальном Windows

- Через NEXUS исполнено: `node --test windows-pc-agent-lab/nexus-selftest/selftest.test.mjs`.
- **8 PASS / 0 FAIL / 0 SKIP**, exit code 0. Отдельно пройдены secret canary, fail-closed, запрет power.
- Исходный код просмотрен: без файлового, сетевого, процессного I/O; отчёт содержит только безопасные фиксированные поля.
- `git diff --cached --check` прошёл, staged scope Codex строго три файла.
- На переданном **санитизированном реальном снимке** текущего NEXUS получено `overall=WARN`: `gateway_http=PASS`, `connection_verdict=WARN` (ранее восстановленные тайм-ауты Cloudflare), `host_pid=PASS`, `tunnel_alive=PASS`, `power_ban=PASS`, `pending_consents=PASS`, `configuration=PASS`. Это корректное предупреждение о свежем восстановлении сети, а не FAIL.
- Исходные ответы NEXUS не копировались в отчёт с секретами, в evaluator переданы только whitelisted поля.

## GitHub и CI

- Codex-код зафиксирован отдельно коммитом **`ef48e7e`** (только три файла, 191 строка добавлена).
- Оператор добавил независимую branch-only CI конфигурацию `.github/workflows/nexus-selftest-ci.yml`, без публикации, без write scopes, без production; коммит **`f5a7b2d`**.
- Ветка отправлена в `origin/experiment/nexus-codex-selftest-20261106`; `main` не менялся.
- GitHub Actions [run 42138746015](https://github.com/entoni441-prog/mcp-android/actions/runs/42138746015): `Self-test (ubuntu-latest) = success`, `Self-test (windows-latest) = success`; **2/2 PASS**.
- Существующий CI для NEXUS Host повторно не запускался, поскольку затронуты только новый отдельный модуль и его экспериментальный workflow.
- Перед данным документом `git status --short --branch` был чист: только имя экспериментальной ветки.

## Границы доказанного

**Доказано:** NEXUS может сам открыть Windows Codex, выбрать текущий локальный проект, передать задачу, наблюдать фактическое создание кода и завершение Codex, независимо выполнить локальные тесты, зафиксировать коммиты, опубликовать экспериментальную ветку и получить успешную независимую GitHub CI на Windows и Linux.

**Не доказано и не заявляется:** автономная многочасовая разработка, восстановление Codex после crash, production deployment, непрерывная работа без reconnect и полная поддержка защищённых системных окон. Codex не осуществлял push самостоятельно: публикацию и проверку выполнил оператор через NEXUS, как и было предусмотрено заданием.

**Решение:** E2E данной строго ограниченной задачи PASS. Не переделывать ранее принятые NX-03/13/19/21/26 и не делать повторных установок без новых объективных причин.
