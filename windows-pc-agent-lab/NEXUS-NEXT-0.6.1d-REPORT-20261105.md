# NEXUS 0.6.1d — адресные исправления, 05.11.2026

Статус: CODE REVIEW CANDIDATE, НЕ УСТАНОВЛЕНО. Коммиты исходников опубликованы; Windows/Linux/Gateway CI 42013344466 — PASS. Реальная приёмка исправлений на ПК владельца ещё не проводилась.
Ветка: experiment/nexus-0.6.1d-acceptance-fixes-20261105. HEAD кода при CI: 6bbabe8b5a174b4d5f286ef4f574ddcc9161dfae. Отдельные коммиты: b4b43b8, eaffb74, 93fe468, af8fc4b, 6bbabe8.
Основа: 5043be7; диагностика 422f691. b4b43b8 (Format-List) и eaffb74 (AppX) сохранены.

## Матрица доказательств
| Дефект | Коммит / отдельный diff | Регрессионный тест | Windows локально | Windows / Linux CI run | Итог приёмки |
|---|---|---|---|---|---|
| NX-052-03 | eaffb74; 00-NX03-existing-eaffb74.patch | stage2-052.test.mjs: N-01 discovery index, ChatGPT AppX fixture | PASS проверки индекса | 42013344466: PASS Windows/Linux/Gateway | BLOCKED: реальный discovery/open_app в контексте владельца не проверен |
| NX-052-13 | 93fe468; 01-NX13.patch | consent.test.mjs: NX-052-13 native Edge translation bubble | PASS | 42013344466: PASS Windows/Linux/Gateway | BLOCKED: нативный HWND parent bubble и реальный Close ещё не проверены |
| NX-052-19 | af8fc4b; 02-NX19.patch | windows.test.mjs: NX-052-19 shared Explorer shell | PASS | 42013344466: PASS Windows/Linux/Gateway | BLOCKED: нет Explorer window в доступном UIA desktop; реальная видимость не доказана |
| NX-052-21 | 6bbabe8; 03-NX21.patch | stage2-052.test.mjs: NX-052-21 Steam helper; real PowerShell ancestry | PASS, включая реальный Windows PowerShell с fixture CIM | 42013344466: PASS Windows/Linux/Gateway | BLOCKED: реальный Steam launch/cleanup и PWA focus не проверены |
| NX-052-26 | изменений нет | нового теста нет: исправление не выбрано | BLOCKED | NONE / NONE | BLOCKED: UIA из песочницы даёт csrss / topHwnd 0; msinfo32 отсутствует |
| Автовозобновление | изменений нет | существующий контракт stage3-052.test.mjs: NEXT-1 lifecycle / restart | в этом проходе не повторялся | NONE / NONE | Ошибка не подтверждена: host_restart resume предусмотрен NEXT-1; owner STOP требует allowResume |

PASS в колонке тестов означает только результат указанной проверки, не приёмку на ПК владельца и не готовность к установке.

## Изменения по дефектам
NX-13: разрешается только Close нативного Edge Translate Pane с собственным ненулевым HWND, отличным от главного окна, точным классом и переводческим заголовком. Неопределённые Pane/Group, другие приложения, диалоги и явный Close window остаются gated. UIA возвращает ограниченные parent metadata. Исключение для любого дочернего контейнера из незавершённой правки сужено.

Антигравити добавлял также разрешение закрытия любого окна по owned PID. Оно не включено: нарушало бы 0.4.3 для общих процессов и чужих вкладок. Оригинальные consent.mjs и diff сохранены отдельно; работа не сбрасывалась. Проверки owner tabs / cold restore / snapshot failure сохранены.

NX-19: CLM-совместимый Get-Process inventory сохранён; список дополнен существующим UIA apps('explorer'), только CabinetWClass с валидным PID/HWND. Все окна общего PID сохраняются; заголовки выдаются только includeTitles=true. UIA failure возвращает partial:true / explorerInventory:unavailable и прежний inventory. Пустой UIA не удаляет известные окна.

NX-21: UIA сопоставляет Steam helpers по живой цепочке Win32_Process (только steam.exe / steamwebhelper.exe, одна сессия, время создания ребёнка не раньше родителя, ограничение глубины). Неизвестная ancestry не добавляет helper. windows(pid launcher) и snapshotApp('steam') видят подтверждённых потомков. Launcher получает ownership только после cold snapshot и окна с launchRootPid, равным именно PID запуска, которое recordCreated уже признал owned. Restored tabs и snapshot failures сохраняют отказ 0.4.3. list_processes учитывает существующий consent ownership. Владение PID не разрешает автоматически закрывать произвольное окно этого PID.

## Фактические проверки
- targeted-tests-windows.txt: 72 теста, 71 PASS, 0 FAIL, 1 SKIP (GUI/Notepad launch требует NEXUS_REAL_GUI=1). Проверялись gui, consent, windows, stage2, modules; реальная GUI приёмка не запускалась.
- После уточнения точного launchRootPid: nx21-final-windows.txt — 2 PASS, 0 FAIL. Тест покрывает также чужой root PID, восстановленные вкладки и отражение helper ownership в list_processes.
- Адресный запуск NX-13/19/21 + AppX index: 5 PASS, 0 FAIL. После этих локальных проверок запущен GitHub Actions 42013344466: host Windows, host Ubuntu и Gateway — PASS.
- Раздельные patches применены последовательно к копии восьми исходных файлов HEAD; итог совпал с worktree после нормализации Git line endings. Проверка не меняет Git metadata.
- Read-only discovery в sandbox: chatgptDiscovered:false; Get-StartApps/Get-AppxPackage не вернули ChatGPT, при этом Get-Process видит WindowsApps/OpenAI.Codex/.../ChatGPT.exe. Из этого нельзя заключать результат в профиле владельца.
- Read-only UIA sandbox: focused={ok:true,pid:1460,process:csrss,topHwnd:0}; Explorer Cabinet windows=0; list_windows explorer=0; partial:false. msinfo32 и Steam не запущены. Это не приёмка исправлений.

## Git / CI и следующий шаг
Исходная база 5043be7, отдельная ветка experiment/nexus-0.6.1d-acceptance-fixes-20261105. Действия выполнялись через NEXUS Host в рабочем source worktree, не в установленной папке Host. Глобальные Git-настройки и credentials не изменялись.

| Изменение | Коммит |
|---|---|
| Format-List, уже был выполнен | b4b43b8 |
| NX-052-03 AppX discovery (код не принят на ПК) | eaffb74 |
| NX-052-13 Edge Translate bubble | 93fe468 |
| NX-052-19 Explorer window inventory | af8fc4b |
| NX-052-21 Steam launch/helper ownership | 6bbabe8 |

Отдельные коммиты NX-13/19/21 сформированы из заранее подготовленных патчей с `git apply --cached` (общий uia-script.mjs разделён по hunks). Staged diff проверен, рабочее дерево runtime после индексации совпало. Push в указанную экспериментальную ветку выполнен **без force**, и SHA на GitHub повторно подтверждены.

**CI:** https://github.com/entoni441-prog/mcp-android/actions/runs/42013344466 — source SHA `6bbabe8b5a174b4d5f286ef4f574ddcc9161dfae`; gateway **PASS**, host (windows-latest) **PASS**, host (ubuntu-latest) **PASS**. Это проверка кода, НЕ реальная приёмка на компьютере владельца.

**SKIP в локальном пакете:** `REAL: Windows PowerShell executes the fixed script and returns a valid list` — требует запуска реального GUI/Notepad при `NEXUS_REAL_GUI=1`; не тест NX-13/19/21. Локальный набор 71 PASS / 0 FAIL / 1 SKIP.

**Открытые ограничения:** NX-03, 13, 19, 21 ещё требуют адресных тестов на ПК владельца ПОСЛЕ отдельно разрешённой установки; NX-26 не исправлялся, требуется диагностика. Автовозобновление задачи не признано дефектом, изменения не внесены. Runtime Host/Gateway и `power` не трогались.

Следующее: независимое ревью diff; отдельное разрешение владельца на установку по `ACTIVATE-NEXT-0.6.1d.md` с backup и регламентным откатом; затем повторная приёмка только ранее проваленных кейсов. Ни один пункт не помечать PASS до его реального подтверждения.

## Новые находки (только отчёт)
В discover.mjs заголовочный комментарий всё ещё говорит, что UWP не перечисляются, хотя eaffb74 добавил AppX. Не исправлялся отдельно. UIA desktop sandbox не даёт достаточного контекста для диагностики NX-26; технический обход foreground lock без воспроизводимого доказательства не добавлялся.
