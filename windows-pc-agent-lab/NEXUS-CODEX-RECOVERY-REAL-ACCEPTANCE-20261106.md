# NEXUS → Codex — реальная приёмка восстановления, 06.11.2026

**Результат:** `WORKER_CRASH_RECOVERY=PASS`, `ISOLATED_TCP_RETRY=PASS`, `PRODUCTION_TUNNEL_FAILOVER=NOT_TESTED`.
**Граница:** успешно испытаны восстановление отдельного рабочего процесса при продолжении Codex и повтор TCP-запроса без дублирования в изолированной среде. **Не** доказаны самовосстановление упавшего Codex Desktop и восстановление всей цепочки через реальное отключение Cloudflare.

## Исходная база и ограничения

- Исходный подтверждённый чекпоинт: `44352b1779c21b21d397fb23cc7735c80c9097bd`.
- Экспериментальная ветка: `experiment/nexus-codex-recovery-20261106`, отдельно от `main`.
- Рабочая копия: `C:\Users\krado\Documents\NEXUS\_src-next-0.6.1d-clean`.
- До испытания: NEXUS Host PID `23324`, Cloudflare Gateway HTTP 200, `power=false`, `ownerBans=["power"]`, 0 pending consents. Реальные NX-03/13/19/21/26 не повторялись.
- Владелец разрешил автономную тестовую приёмку. NEXUS контролировал Windows и взаимодействовал с существующим Codex Desktop. Для конкретных команд Codex выдавались **разовые** разрешения; постоянное автоматическое одобрение не включалось.
- Защита: никакой остановки NEXUS Host, Gateway, cloudflared, Codex Desktop, пользовательских приложений, изменения production/main, security или power.

## Этап 1 — реальный аварийный stop отдельного Node worker

1. Codex после проверки branch, HEAD и `git status` самостоятельно создал три новых файла `windows-pc-agent-lab/nexus-recovery-lab/{worker.mjs,worker.test.mjs,README.md}`. Начальный набор тестов в песочнице Codex столкнулся с `EPERM` для hard link; после разового разрешения выполнения тестов вне *файловой* песочницы тесты прошли.
2. Единственная папка данных: `C:\Users\krado\Documents\NEXUS\_recovery-e2e-20261106` (вне репозитория, не публиковалась). Codex запустил worker, который создал `checkpoint.json` и `effect-once.txt`; внешние эффекты не производились.
3. До сбоя `checkpoint.json` содержал `taskId:"nx-codex-recovery-20261106"`, `stage:"waiting_for_crash"`, `pid:23360`, `timestamp:"2026-11-06T01:01:15.398Z"`. Контрольный SHA-256 `checkpoint.json`: `1f430c46ade344b1b77d7b97a0b0dd313eef7af5b3b0074f06331d24ca8fc9bc`.
4. NEXUS через Windows проверил PID `23360`: `node.exe`, командная строка точно содержала путь `nexus-recovery-lab/worker.mjs` и отдельный sandbox, время создания отличалось от checkpoint на 0,04 с. Только после этих проверок выполнен `Stop-Process -Id 23360 -Force`. Возвращено **`INJECTED_PID_TERMINATED`**, повторная проверка процесса: отсутствует.
5. SHA-256 `effect-once.txt` **до и после** остановки: `ddf3da33ee4811ceba5fba27d905a0108107f2685b7d753ca6ccca296582a69d`; размер 40 байт, содержимое `nx-codex-recovery-20261106: effect once\n`. Никакой второй записи.
6. **Без дополнительного пользовательского поручения** Codex в той же сессии распознал аварийный выход команды, изучил checkpoint (однократно разрешено чтение 15 строк аудита NEXUS) и через разовое разрешение повторно запустил тот же worker; наблюдаемый новый PID **17336**. Вывод Codex: `RECOVERED_COMPLETE`, exit 0.
7. `complete.json` содержал `{"taskId":"nx-codex-recovery-20261106","recovered":true}`; SHA-256 `3ca65875f0fe05addade52079b6329a5b113aded3d1982df6e8b270c4fa0bddc`. Исходный checkpoint и одноразовый эффект сохранились.
8. Независимый запуск через NEXUS `node --test windows-pc-agent-lab/nexus-recovery-lab/worker.test.mjs`: **2 PASS / 0 FAIL / 0 SKIP**; сценарии crash/resume, unchanged effect, COMPLETE-replay rejection, invalid-state fail-closed.
9. Финальная read-only проверка обоих PID `23360`, `17336` — **не запущены**.

**Вердикт этапа 1: PASS** в границе контролируемого рабочего Node процесса. Codex продолжил после реальной ошибки команды без нового текстового задания; он запросил разовые подтверждения действий, которые оператор NEXUS одобрял в рамках разрешённого пользователем сценария. **Это не тест падения процесса Codex Desktop или NEXUS Host.**

## Этап 2 — реальный обрыв отдельного TCP-соединения

1. Codex добавил `transport.mjs`, `transport.test.mjs` и раздел README. Не изменял исходные файлы worker.
2. На локальном Windows через `node:net` запускается тестовый сервер **только `127.0.0.1`, случайный порт 0**. Клиент посылает синтетическую операцию с фиксированными `taskId` и `idempotencyKey`.
3. Сервер принимает первый запрос, фиксирует **один** эффект в памяти, уничтожает сокет **после commit, но до ACK**. Клиент видит обрыв, создаёт второе TCP-соединение и повторяет исходное сообщение с тем же ключом; сервер дедуплицирует и отвечает ACK. Установленных сторонних пакетов, внешних подключений и production-трафика нет.
4. Независимый демонстрационный запуск `node .../transport.mjs`:
   `{"status":"PASS","connectionCount":2,"forcedDrops":1,"committedEffects":1,"retryCount":1,"originalId":"unchanged","ack":true}`.
5. Независимые тесты `node --test .../transport.test.mjs`: **4 PASS / 0 FAIL / 0 SKIP**, включая no-reconnect negative control, invalid key fail-closed и синтетический secret canary. Сокеты и сервер ограничены по времени, корректно закрываются.
6. **Вердикт этапа 2: PASS** для реального **loopback TCP** drop/retry. Состояние дедупликации находится только в оперативной памяти тестового сервера; тест **не доказывает** exactly-once внешнего сервиса, восстановления после server restart или Cloudflare tunnel failover.

## GitHub и CI

- Код этапа 1 (Codex): `f1ec9d9`, ровно три файла.
- Код этапа 2 (Codex): `1755639`, два новых файла и README.
- Отдельный экспериментальный GitHub Actions workflow: `.github/workflows/nexus-recovery-lab-ci.yml`, коммит `d08156f`, scope только этой experiment-ветки, `contents: read`, Node 24, Windows/Linux.
- Публикация `git push` только `experiment/nexus-codex-recovery-20261106`. CI [42142031447](https://github.com/entoni441-prog/mcp-android/actions/runs/42142031447): **Recovery lab (windows-latest) success**, **Recovery lab (ubuntu-latest) success**, **2/2 PASS**.
- Независимая проверка NEXUS: Host PID `23324`, `cloudflaredAlive=true`, `Gateway=ok` HTTP `200`, `pendingConsents=0`, `power=false`, `ownerBans=["power"]`, нет ошибки конфигурации. `git status` до настоящего документа чист.

## Итог и дальнейшие границы

Тесты подтверждают: после реального завершения worker Codex продолжил выполнение по ранее сохранённому checkpoint и завершил задачу без дублирования тестового эффекта; отдельно проверен реальный TCP-обрыв после commit с ровно одним повтором и ACK. Разовые разрешения в интерфейсе Codex не равнозначны полному unattended mode. Для проверки полного восстановления всей цепочки через **настоящий обрыв Gateway/Cloudflare**, длительный сбой Codex Desktop и persisted dedup у внешнего сервиса требуется отдельное безопасное тестирование с независимым каналом восстановления; текущие production-компоненты не отключались.

**Решение:** принять два изолированных сценария, не считать их подтверждением общей отказоустойчивости production, сохранять текущую рабочую инфраструктуру без изменений.
