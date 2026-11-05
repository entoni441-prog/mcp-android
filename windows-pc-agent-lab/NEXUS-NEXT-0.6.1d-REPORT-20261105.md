# NEXUS 0.6.1d CLEAN — сборка без NX-03 (05.11.2026)

**Статус: REVIEW CANDIDATE, НЕ УСТАНОВЛЕНО.** Рабочая 0.6.1c не изменена.
Ветка `experiment/nexus-0.6.1d-20261105`, база `5043be7`. Единственные исправления Host: NX-052-13, NX-052-19, NX-052-21.

## Коммиты
- `3090487` — cherry-pick `93fe468`: закрытие Edge Translate bubble; тест `consent.test.mjs`.
- `6aa4caa` — cherry-pick `af8fc4b`: учёт окон Explorer; тест `windows.test.mjs`.
- `897b9e36c8d47b608682e3abbc41b541d4be1a9b` — cherry-pick `6bbabe8`: учёт Steam helper; тест `stage2-052.test.mjs`.
- `6430d3d` — только `.github/workflows/nexus-host-ci.yml` (добавлена новая экспериментальная ветка для CI; никаких Host/Gateway runtime изменений).

Cherry-pick прошёл без конфликтов; `stage2-052.test.mjs` объединён автоматически. Diff от `5043be7`: **5 runtime файлов** `consent.mjs`, `uia-script.mjs`, `windows.mjs`, `apps.mjs`, `procs.mjs` + **3 файла тестов**. Манифест `MANIFEST-NEXT-0.6.1d.sha256` содержит ровно пять runtime SHA256, он сверяется перед установкой.

**NX-03 (`eaffb74`) исключён полностью:** `discover.mjs` не менялся, AppX тест не перенесён. NX-26 и PWA focus не исправлялись. Подтверждённый ранее ложный guard `Format-List` (`b4b43b8`) также не включён, поскольку задача разрешила ровно три cherry-pick исправления.

## Проверки и CI
- Локальный Windows `node --test consent.test.mjs windows.test.mjs stage2-052.test.mjs`: **36 PASS / 0 FAIL / 1 SKIP**. SKIP — real GUI Windows/Notepad, требует `NEXUS_REAL_GUI=1` и не является регрессией NX-13/19/21.
- CI workflow `nexus-host-ci`, запуск **42033667151** на SHA `6430d3d`: Gateway PASS, Ubuntu PASS, Windows PENDING по состоянию на формирование отчёта; окончательный статус требует проверки. CI SHA отличается от кода `897b9e3` только разрешением триггера в YAML.
- Зелёный CI не означает приёмку на ПК владельца: NX-13/19/21 требуют адресного E2E после разрешённой установки.
- Старый `ACTIVATE-NEXT-0.6.1d.md` с NX-03 помечен отменённым в старой ветке отдельным docs-only коммитом `bd8aa74` (без force, старые SHA/CI сохранены).

## Ограничения
Ветка `main`, рабочий Host 0.6.1c, Gateway, Wrangler, `power`, система owner-approval и fail-closed ownership 0.4.3 не менялись. Установка не запускалась и не разрешена. Следующий шаг — независимый ревью кода/манифеста/ACTIVATE, затем отдельное разрешение владельца, backup и проверка только NX-13/19/21. NX-03 — кандидат отдельной ветки 0.6.1e без ACTIVATE. NX-26 — диагностика отдельно.

## Доработка NX-21 после Claude review (05.11.2026)

Исходный HEAD: 6430d3d184a9a64e3c7fafa2d8b40eaed218a255. NX-13 и NX-19 приняты и не изменены. При переданном launchPid новое окно Steam/steamwebhelper получает ownership только при launchRootPid === launchPid; чужой или отсутствующий root возвращает foreign_launch_root до регистрации окон, вкладок и PID. Делегирование старому Steam в трее при пустом snapshot требует согласия на закрытие. Нормальный холодный запуск сохраняет ownership, restored tabs остаются fail-closed (0.4.3).

Адресная проверка: node --test --test-name-pattern=NX-052-21 windows-pc-agent-lab/nexus-host/stage2-052.test.mjs — 2 PASS, 0 FAIL. Ранее прошедшие локальные проверки не повторялись. Исторические результаты выше относятся к прежним SHA. Новый CI Windows/Linux/Gateway ожидается после push коммита с этой доработкой; точный SHA и CI URL фиксируются в итоговом ответе. Установка запрещена; backup/rollback описаны в ACTIVATE. NX-03/discover.mjs, runner b4b43b8, Host 0.6.1c, Gateway, main, power и security не изменены.

## Заключительный статус подготовки (05.11.2026, после CI и повторного ревью)

Этот раздел обновляет промежуточные CI PENDING выше. Код NX-21 и четыре подготовительных документа опубликованы в исходном коммите [`ba9689d4eee5c2a9d83e67475dd405eabdf39119`](https://github.com/entoni441-prog/mcp-android/commit/ba9689d4eee5c2a9d83e67475dd405eabdf39119). Ветка `experiment/nexus-0.6.1d-20261105`; предыдущий SHA `6430d3d` сохранён в истории. Никаких force-push.

- GitHub Actions [42072599361](https://github.com/entoni441-prog/mcp-android/actions/runs/42072599361): **Windows PASS, Linux PASS, Gateway PASS**, все три jobs завершены успешно на коде `ba9689d4`.
- Локально: `node --test consent.test.mjs windows.test.mjs stage2-052.test.mjs`: **36 PASS, 0 FAIL, 1 SKIP**; `git diff --check` без замечаний, манифест **5/5 SHA256 PASS**.
- Claude провёл повторное независимое ревью: **NX-21 ACCEPTED (нет блокирующих дефектов кода), READY FOR INSTALL REVIEW**. Согласованные NX-13 и NX-19 не изменялись. Claude отметил три уточнения `ACTIVATE`: точный immutable source SHA, проверка supervisor после запуска и обязательный реальный Steam E2E. Все три отражены в последующем docs-only обновлении инструкции.
- **УСТАНОВКА НЕ ВЫПОЛНЕНА И НЕ РАЗРЕШЕНА.** Перед ней требуется отдельное решение владельца. Действующий Host 0.6.1c, Gateway, `main`, `power`, owner security не менялись. NX-03/discover.mjs и NX-26 не входят в 0.6.1d.

## Статус после реальной установки и приёмки (05.11.2026)

**Установка выполнена, Host online.** Исходный код `ba9689d4` установлен заменой ровно пяти runtime файлов, SHA256 5/5 PASS; supervisor восстановился. CI 42072599361: 3/3 PASS. Резервная копия находится в `C:\Users\krado\Documents\NEXUS\_backup-0.6.1d-clean-pre-20261105T175130Z`.

**Реальная приёмка:** NX-19 **PASS**; NX-13 **FAIL** (реальное Edge Translate popup распознано UIA, но попытка нажать `Закрыть` вернула `consent_required` для основного окна — consent отменён); NX-21 **защита PASS / полный E2E BLOCKED** (вторая попытка открыть Steam не присвоила существующее окно, закрытие чужого окна запросило consent, но заранее работающего Steam владельца не было). Критического нарушения безопасности нет; откат не выполнялся. Полный отчёт [`NEXUS-NEXT-0.6.1d-REAL-ACCEPTANCE-20261105.md`](./NEXUS-NEXT-0.6.1d-REAL-ACCEPTANCE-20261105.md) содержит диагностику и план исправления.
