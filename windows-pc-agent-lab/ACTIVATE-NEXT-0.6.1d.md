# ОТМЕНЁН — исторический ACTIVATE 0.6.1d, НЕ ИСПОЛНЯТЬ

Этот вариант относится к старой экспериментальной ветке `experiment/nexus-0.6.1d-acceptance-fixes-20261105` и включает непринятый NX-03 (`discover.mjs`). Он отменён для установки, но сохранён для аудита. Действующая инструкция-кандидат 0.6.1d **без NX-03** находится в отдельной ветке `experiment/nexus-0.6.1d-20261105` (и сама не разрешает установку без ревью и отдельного согласия владельца). Никаких файлов рабочего Host изменять по этому документу нельзя.

---

# ACTIVATE — NEXUS 0.6.1d, подготовлено для независимого ревью

НЕ ИСПОЛНЯЛОСЬ. Разрешения на установку нет. Рабочий Host 0.6.1c продолжает работать.
Отдельные коммиты готовы, Windows/Linux/Gateway CI 42013344466 — PASS. Установка по-прежнему BLOCKED до отдельного разрешения владельца и ревью. Этот файл не даёт разрешения на выполнение.

## Перед отдельным разрешением
Подтверждённый code release SHA: `6bbabe8b5a174b4d5f286ef4f574ddcc9161dfae` (экспериментальная ветка). CI run: `42013344466` — gateway job `127197592507` PASS, Windows job `127197592913` PASS, Linux job `127197593150` PASS. Семь runtime hashes MANIFEST-NEXT-0.6.1d-CANDIDATE.sha256 проверены по source worktree: 7/7 совпадений. Перед установкой повторно сверить immutable source hashes. Зафиксировать семантический diff к 5043be7. Отдельно решить BLOCKED NX26/PWA focus и ограничения проверки NX03/13; не объявлять их PASS заранее.

## Бэкап после разрешения, до замены
Рабочий HostDir по предыдущему install report: C:\Users\krado\Documents\NEXUS\nexus-host. Прочитать действие существующей задачи NEXUS-Host-Run и убедиться, что WorkingDirectory совпадает; если нет — остановить процедуру и уточнить фактический путь. Ничего в задаче не менять.
Создать новый уникальный C:\Users\krado\Documents\NEXUS\_backup-0.6.1d-pre-<timestamp>. Скопировать только семь runtime файлов: runner.mjs (b4b43b8), discover.mjs (eaffb74), consent.mjs и uia-script.mjs (NX13), windows.mjs (NX19), apps.mjs и procs.mjs (NX21; uia-script.mjs общий с NX13). Сохранить SHA256 исходных файлов и бэкапа, размер, дату и source release SHA. Сверить каждый backup hash до продолжения. Если файл отсутствует/хэш не совпал — остановиться, ничего не заменять.
Сохранить текущие host.pid и supervisor.pid и read-only сведения об этих процессах. Не копировать/выводить credentials, capabilities, owner approvals, .nexus-host task journal или секреты в review package.

## Адресная замена и перезапуск после разрешения
1. Убедиться, что нет активной работы владельца и незавершённого input. Проверить PID и CommandLine существующих Host/supervisor: они должны относиться ровно к HostDir. При сомнении остановиться; PID из старого отчёта не использовать.
2. Штатная процедура 0.6.1c: остановить supervisor по проверенному текущему PID, затем Host по его текущему PID, БЕЗ /t. Не создавать/удалять owner-stop.json или host-off. Не менять ScheduledTask definitions и не запускать старые C.5 tree-kill tests.
3. Заменить только перечисленные семь runtime файлов из immutable release. Проверить SHA256 установленного каждого файла против manifest. Не копировать весь каталог, тесты или .git.
4. Запустить существующую задачу: Start-ScheduledTask -TaskName 'NEXUS-Host-Run'. Прямой node launch, новая задача и изменение security settings не требуются.
5. Проверить /healthz, фактические новые Host/supervisor PID и состояние соединения; ожидаемая строка версии по прежнему контракту 0.6.1-next. Версия одна не доказывает обновление: нужны хэши файлов и release SHA в отчёте. При ошибке — откат, не повторять рестарты бесконечно.

## Только адресная приёмка после разрешённой установки
NX03: discovery + open_app chatgpt (проверить фактическое окно, bare exe доступность и политику agent).
NX13: на реальном Edge Translate bubble проверить parent HWND/class/title, закрыть только bubble; отдельно проверить, что window Close и чужая вкладка сохраняют owner consent.
NX19: NEXUS Explorer окно видно в list_windows, включая общий shell PID; закрыть ровно своё окно. ZIP extraction не повторять.
NX21: cold Steam launch, GUI helper связь с точным launch PID, createdByNexus, list_processes, focus и закрытие только своих окон. Session restore / неопределённая ancestry должны оставаться fail-closed. PWA focus пока нерешён, не отмечать PASS по Steam.
NX26: отдельно согласовать диагностику доступного desktop для msinfo32; в текущем кандидате исправления нет. UIA уже PASS по прежнему отчёту, повторять весь UIA тест не требуется.
Автовозобновление не менять без подтверждённого нарушения существующего NEXT-1 / owner STOP контракта.

## Адресный откат
Общий аварийный откат: по тем же проверкам PID остановить supervisor и Host без /t, вернуть семь файлов из точного backup, проверить backup SHA256, Start-ScheduledTask NEXUS-Host-Run, проверить health/connection и хэши. Не трогать Gateway, tunnel config, задачи, capabilities, bans, ownership policies и owner approvals.

Откат ОДНОГО дефекта готовить в изолированной source-копии release: git revert --no-commit <подтверждённый SHA соответствующего fix>, просмотреть diff, выполнить затронутые тесты, получить новый manifest. Только после отдельного review заменить изменившиеся runtime файлы с таким же backup/перезапуском. До создания коммитов те же операции моделируются обратным применением соответствующего 01/02/03 patch в копии исходников, НЕ в рабочем Host.
NX13 и NX21 используют общий uia-script.mjs: нельзя откатывать его целиком к 0.6.1c при откате лишь одного дефекта; нужен source revert конкретных hunks с сохранением второго исправления. NX19 откатывает только windows.mjs. NX03 — discover.mjs. Format-List/b4b43b8 при адресном откате этих дефектов сохраняется.

## Заполняемый результат
release SHA / backup path + hashes / CI URLs / файлы до-после / PID до-после / health / NX case PASS-FAIL-BLOCKED / rollback SHA, если применялся. Все поля пока PENDING, установка не разрешена.
