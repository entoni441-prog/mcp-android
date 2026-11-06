# NEXUS — реальные отказы Codex Desktop и Cloudflare Tunnel

**Дата испытаний:** 2026-11-06 (UTC; локально Europe/Rome UTC+1).

**Сводный вердикт: PARTIAL PASS.**
- `CODEX_DESKTOP_CRASH_INJECTION`: PASS.
- `CODEX_THREAD_AND_CHECKPOINT_RESTORED`: PASS.
- `CODEX_AUTONOMOUS_TASK_RESUME_AFTER_DESKTOP_CRASH`: **FAIL**.
- `CODEX_MANUAL_ASSISTED_RESUME`: PASS.
- `REAL_CLOUDFLARED_PROCESS_FAILOVER`: **PASS**.
- `INFLIGHT_NEXUS_COMMAND_SURVIVES_REAL_TUNNEL_OUTAGE`: **PASS**.

## Безопасная исходная база

- Repo `entoni441-prog/mcp-android`, отдельная ветка `experiment/nexus-real-host-codex-recovery-20261106` от принятого `6b82d82c6412aa40446a2196869ed728f7dff1e7`.
- Запущенный NEXUS Host `23324`, supervisor `20656`, исходный cloudflared `20492`; Gateway HTTP 200; `power=false`, `ownerBans=["power"]`.
- Перед действиями проверен установленный `nexus-host/nexus.mjs` против source SHA-256 `4a6b7132aa46d2f8b267857aea2194a13a47138cc653a1a8facca25b857ac6e8`: **exact match**.
- Никаких изменений Host-runtime, Gateway, `main`, политик безопасности, выключения Windows, установок ПО или платных ресурсов.
- Все материалы испытания создано в отдельных локальных папках `C:\Users\krado\Documents\NEXUS\_codex-desktop-crash-20261106` и `_real-failover-20261106`. Секреты, URL туннеля и содержимое пользовательских чатов в отчёт не включены.
- Поступил явный запрос владельца провести реальные испытания. Предыдущее испытание worker и loopback TCP в `6b82d82` не повторялось без причины.

## 1. Реальное падение Codex Desktop

1. Через NEXUS открыт существующий Codex Desktop, создана отдельная тема «Проверить сбой Codex Desktop». Рабочая Git-ветка и чистое состояние проверены.
2. Codex использовал существующий `windows-pc-agent-lab/nexus-recovery-lab/worker.mjs`; написал в пустой тестовый sandbox `checkpoint.json` (`taskId=nx-codex-recovery-20261106`, `stage=waiting_for_crash`, `workerPid=21692`, timestamp `2026-11-06T01:24:00.074Z`) и один `effect-once.txt`.
3. SHA-256 эффекта перед сбоем: `ddf3da33ee4811ceba5fba27d905a0108107f2685b7d753ca6ccca296582a69d`, размер 40 байт.
4. NEXUS до инъекции адресно проверил главное приложение `ChatGPT.exe` PID **16124**, принадлежность к установленному пакету `OpenAI.Codex_...`, сеанс 1, отсутствие `--type=` и одновременно активный тестовый worker PID **21692** с точной командной строкой на sandbox.
5. **`Stop-Process -Id 16124 -Force`**: корневой Codex Desktop действительно остановлен; вместе с ним завершён worker PID 21692. Независимые `list_windows` / `list_processes` показали **0 окон и 0 процессов** ChatGPT. NEXUS Host остался Online.
6. Через NEXUS `open_app chatgpt` повторно открыт Codex Desktop (новый PID **21956**). Предыдущая тема, проект и переписка восстановлены, но **нет продолжающегося выполнения без нового поручения**. В sandbox по-прежнему только `checkpoint.json` и `effect-once.txt`, **`complete.json` отсутствовал**. **AUTONOMOUS_RESUME=FAIL**.
7. После документирования FAIL оператор отправил **новое явное поручение** в восстановленную Codex-тему и разово разрешил запуск того же worker. Codex завершил задачу из checkpoint (`complete.json` с `recovered:true`); SHA-256 эффекта остался исходным. **MANUAL_ASSISTED_RESUME=PASS**, не выдавать за unattended.

**Диагноз:** устойчиво хранятся чат, проект и файл чекпоинта; отсутствует подтверждённый автономный контроллер, способный обнаружить исчезновение Codex Desktop, заново поднять приложение и продолжить активное задание без нового пользовательского сообщения. Старый NEXUS NX-03 cold-start PASS этого не гарантирует.

## 2. Реальный cloudflared crash и самовосстановление

1. До инъекции подтверждены `hostPid=23324`, `supervisorPid=20656`, `cloudflaredPid=20492`, точный исполняемый путь и родительский PID Cloudflare, `/healthz=200` и pinned source SHA. `host-off` и sticky owner STOP отсутствовали.
2. Windows Execution Policy запретила запуск отдельно созданного `.ps1`; **политику не изменяли и не обходили**. Вместо этого использован локальный Node.js `_real-failover-20261106/tunnel-failover.mjs`, проверенный через `node --check` и `--check`. Запускался отдельным detached наблюдателем с журналом `tunnel-result.json` и однократным флагом исполнения.
3. В `2026-11-06T01:32:22.125Z` завершён **только подтверждённый дочерний cloudflared PID 20492**. Реально наблюдался временный Cloudflare **HTTP 530**.
4. Host автономно зафиксировал `cloudflared_exit`, запланировал `tunnel_restart_scheduled=2s` в `01:32:22.133Z`, затем `tunnel_start` в `01:32:24.384Z`. Новый **PID 21388** успешно зарегистрирован в `01:32:29.905Z` (`registered:tunnel_restart`).
5. От kill до регистрации **≈7.78 секунды**. `connection_status` снова получил **HTTP 200**. Host PID 23324 и supervisor PID 20656 остались прежними. Detached observer записал `status=RECOVERED_LOCAL_REGISTERED`.
6. Временный диагностический `verdict=tunnel_process_exited` после успеха отражал свежий факт выхода прежнего процесса, **не означал текущую недоступность** при HTTP 200.

**REAL_TUNNEL_FAILOVER=PASS**. Не делалось ручного restart Host или Gateway.

## 3. Дополнительная реальная проверка: команда в момент Cloudflare 530

Это **другой сценарий**, не бессмысленный повтор: первый тест не содержал выполняющейся команды NEXUS в момент сбоя.

1. Через установленный NEXUS запущена **один раз** отдельная bounded команда `node inflight-task.mjs`: Command ID **`c-fbd4201578`**, тестовый worker PID **1964**, старт **`01:35:10.705Z`**, ответ `INFLIGHT_READY`. Скрипт создаёт один `checkpoint.json` и один `effect-once.txt` в `_real-failover-20261106/inflight`, ожидает 25 секунд, затем один `complete.json`. Никаких внешних эффектов.
2. Пока команда была в работе, второй отдельный detached observer с однократным состоянием `inflight-tunnel-result.json` адресно завершил **только текущий cloudflared PID 21388** в **`01:35:24.005Z`**. Cloudflare действительно дал HTTP **530**.
3. Тот же Host `23324` без restart поднял новый cloudflared PID **10128** и повторно зарегистрировал туннель **`01:35:30.871Z`**, то есть ≈6.87 секунды от инъекции. Вскоре Gateway вновь отдал HTTP 200.
4. Без повторного запуска команды NEXUS `run_command(action=status,id=c-fbd4201578)` вернул **тот же ID**, `state=exited`, `exitCode=0`, stdout `INFLIGHT_READY pid=1964` + `INFLIGHT_COMPLETE pid=1964`, конец `01:35:35.773Z`.
5. Три файла проверены по отдельности:
   - `checkpoint.json`: `taskId=nx-real-cloudflare-inflight-20261106`, `stage=running`, PID 1964; SHA-256 `84223f5efa384bb879ec58bf0fa2a085ae11ca74e501b5739318f9b4c895e9bf`.
   - `effect-once.txt`: **одна** строка, 48 байт, `nx-real-cloudflare-inflight-20261106:one-effect`; SHA-256 `30924a87d379a2bbba3b77168e6da188020327d5397cf26157433e144c1f3290`.
   - `complete.json`: тот же taskId, `completed:true`; SHA-256 `03bead6ee13fccc8883474eaab22b6a2dac62f5ee1739fe0ab0c3a759a563c72`.
6. Host 23324, supervisor 20656 и запрещение `power` не изменились. Не запускались повторные внешние команды или необратимые операции. Сценарий **INFLIGHT_COMMAND_SURVIVES_TUNNEL_OUTAGE=PASS**.

**Граница:** доказано продолжение уже исполняемой *локальной* команды Host и её последующее отслеживание через тот же command ID после восстановления доступа. Не доказано переживание отключения самого Host или end-to-end идемпотентность внешнего сервиса при неизвестном результате.

## Решение

**Принять без исправлений:** реальный Cloudflare failover и сохранение работающей локальной команды NEXUS. Эти механизмы на установленной системе подтверждены.

**Открыть адресный backlog:** `CODEX_DESKTOP_UNATTENDED_RESUME` — отдельный контроллер состояния задания, способный после crash приложения определить checkpoint, восстановить GUI/агент и безопасно продолжить, не дублируя внешние действия; с сохранением owner STOP и разовых согласий. Не «исправлять» уже принятые NX-03/13/19/21/26 и Host/Tunnel.

**Сохранность:** никаких изменённых файлов репозитория, кроме нового протокола; исходный production/main и рабочие экземпляры не затронуты. Файлы испытуемых скриптов и checkpoint остаются только в изолированных Windows sandbox, не публикуются.
