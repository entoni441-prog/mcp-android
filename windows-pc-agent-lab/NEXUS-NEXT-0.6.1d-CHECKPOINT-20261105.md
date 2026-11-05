# CHECKPOINT — NEXUS 0.6.1d CLEAN / 05.11.2026

- Ветка: `experiment/nexus-0.6.1d-20261105`; локальный worktree `C:\Users\krado\Documents\NEXUS\_src-next-0.6.1d-clean`.
- База: `5043be7`; независимые исправления: `3090487` NX-13, `6aa4caa` NX-19, `897b9e3` NX-21. CI-only изменение workflow `6430d3d`.
- Код отличается от базы только 5 файлами Host + 3 тестами. `discover.mjs` не менялся; NX-03 отсутствует; NX-26 не исправлен.
- Локальные tests: 36 PASS, 0 FAIL, 1 SKIP (real GUI).
- CI: `42033667151`; Gateway PASS, Linux PASS, Windows PENDING до финального подтверждения.
- Релизный манифест: `MANIFEST-NEXT-0.6.1d.sha256` (5 runtime), инструкция: `ACTIVATE-NEXT-0.6.1d.md` (НЕ УСТАНАВЛИВАТЬ до разрешения).
- Старая ветка `experiment/nexus-0.6.1d-acceptance-fixes-20261105`: архивный ACTIVATE с NX-03 помечен отменённым docs-only коммитом `bd8aa74`; оригинальные SHA/CI сохранены.
- Рабочий Host 0.6.1c, Gateway, main, Wrangler, `power`, owner approval/security неизменны.
- Следующее: подтвердить CI Windows; независимый ревью; NX-03 отдельно как кандидат 0.6.1e без ACTIVATE; установка после отдельного распоряжения; E2E только NX-13/19/21.

## Доработка NX-21 после Claude review (05.11.2026)

Исходный HEAD: 6430d3d184a9a64e3c7fafa2d8b40eaed218a255. NX-13 и NX-19 приняты и не изменены. При переданном launchPid новое окно Steam/steamwebhelper получает ownership только при launchRootPid === launchPid; чужой или отсутствующий root возвращает foreign_launch_root до регистрации окон, вкладок и PID. Делегирование старому Steam в трее при пустом snapshot требует согласия на закрытие. Нормальный холодный запуск сохраняет ownership, restored tabs остаются fail-closed (0.4.3).

Адресная проверка: node --test --test-name-pattern=NX-052-21 windows-pc-agent-lab/nexus-host/stage2-052.test.mjs — 2 PASS, 0 FAIL. Ранее прошедшие локальные проверки не повторялись. Исторические результаты выше относятся к прежним SHA. Новый CI Windows/Linux/Gateway ожидается после push коммита с этой доработкой; точный SHA и CI URL фиксируются в итоговом ответе. Установка запрещена; backup/rollback описаны в ACTIVATE. NX-03/discover.mjs, runner b4b43b8, Host 0.6.1c, Gateway, main, power и security не изменены.

## Финальный проверенный чекпоинт подготовки к установке (05.11.2026)

- **Immutable code SHA:** `ba9689d4eee5c2a9d83e67475dd405eabdf39119` (ветка `experiment/nexus-0.6.1d-20261105`). Документационные изменения после этого SHA не меняют код сборки; для установки использовать именно этот SHA, а не текущий HEAD ветки.
- **CI:** [GitHub Actions 42072599361](https://github.com/entoni441-prog/mcp-android/actions/runs/42072599361) — Gateway **PASS**, Ubuntu **PASS**, Windows **PASS** на указанном code SHA; подтверждено по трём jobs.
- **Локальные адресные тесты:** 36 PASS / 0 FAIL / 1 SKIP (только real GUI/Notepad). SHA-256 всех **5/5 runtime** файлов совпадают с `MANIFEST-NEXT-0.6.1d.sha256`.
- **Независимое ревью Claude:** NX-13, NX-19 ранее приняты; повторное ревью коммита `ba9689d4` не выявило блокирующих дефектов NX-21. Вердикт **READY FOR INSTALL REVIEW**, не является разрешением на установку.
- Три замечания к ACTIVATE устранены **только в документации**: закреплён точный SHA и CI, добавлена обязательная проверка восстановления supervisor после задачи `NEXUS-Host-Run`, подчёркнут реальный E2E Steam ancestry на ПК (CI не заменяет проверку).
- **СТОП установки:** до отдельного явного разрешения владельца. Действующий Windows Host 0.6.1c, Gateway, `main`, `power`, security не изменялись. NX-03 и NX-26 не входят в эту сборку.

## Подтверждённая установка и результаты E2E — 05.11.2026

- Установлен **код `ba9689d4`**, ACTIVATE документ `a0dc4bd`; резервная копия `C:\Users\krado\Documents\NEXUS\_backup-0.6.1d-clean-pre-20261105T175130Z` (5/5 хэшей PASS).
- Установщик `_activate-0.6.1d-20261105.mjs`: `installed_verified`, новый Host PID `21788`, supervisor PID `10212`, health и внешнее соединение PASS, повторная независимая сверка установленных runtime SHA **5/5 PASS**.
- E2E: **NX-19 PASS**, **NX-13 FAIL (Edge Translate: ошибочный запрос согласия на закрытие окна вместо dismiss popup)**, **NX-21 GUARD PASS / полный E2E BLOCKED** (не был заранее запущен Steam владельца). Запросы согласия в тестах отменены, чужие окна не закрывались. Критической регрессии безопасности не обнаружено, откат не запускался.
- Полные доказательства, точные вызовы, PID и диагностика NX-13: [`NEXUS-NEXT-0.6.1d-REAL-ACCEPTANCE-20261105.md`](./NEXUS-NEXT-0.6.1d-REAL-ACCEPTANCE-20261105.md).
- **Следующий шаг:** отдельное исправление NX-13 в экспериментальной ветке, адресные тесты, CI и разрешение на установку. Не повторять NX-19/CI/C.5. `main`, Gateway, `discover.mjs`, `power`, security не менялись.
