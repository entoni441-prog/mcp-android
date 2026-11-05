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
