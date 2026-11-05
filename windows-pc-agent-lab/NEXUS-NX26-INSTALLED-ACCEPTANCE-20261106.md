# NEXUS NX-26 — установлен и принят на реальном Windows

**Дата:** 06.11.2026 Europe/Rome (05.11.2026 23:23–23:26 UTC).
**Итог:** INSTALL PASS / NX-26 TARGETED REAL E2E PASS / ROLLBACK NOT NEEDED.
**Охват:** диагностика перекрытого заголовка; Control Panel/csrss в этот результат не входят.

## 1. Исходники и разрешение

- Владелец прямо разрешил установку ответом «Подтверждаю» на ACTIVATE NX-26.
- Неизменяемый SHA кода: `2f805483e9fef540464a457035b562d1fc678b9d`.
- Базовая 0.6.1d: `ba9689d4eee5c2a9d83e67475dd405eabdf39119`; установленный NX-13: `4cfc3603660fcfc70b3ccb5fca973af0b742d802`. Родословная и исходная база были проверены до установки.
- CI [42125918824](https://github.com/entoni441-prog/mcp-android/actions/runs/42125918824): Windows / Linux / Gateway — 3/3 PASS.
- Регламент: `ACTIVATE-NX26-FOCUS-20261105.md`; манифест: `MANIFEST-NX26-FOCUS-20261105.sha256`.

## 2. Резервная копия и установка

- Хост: `C:\Users\krado\Documents\NEXUS\nexus-host`.
- Взята новая копия: `C:\Users\krado\Documents\NEXUS\_backup-nx26-focus-pre-20261105T232221Z`. SHA-256 и размер двух исходных файлов — 2/2 PASS.
- Применён автономный установщик `C:\Users\krado\Documents\NEXUS\_activate-nx26-focus-20261105.mjs`; до запуска выполнены `node --check` и `--check` → PREFLIGHT_PASS.
- Установщик сохранил журнал `_activate-nx26-focus-20261105-state.json`; фаза **`installed_verified`** в 23:23:46 UTC.
- Остановлены только проверенные прежние Host PID `21640` и supervisor PID `19208`, без `taskkill /t`.
- Новые PID после существующего `NEXUS-Host-Run`: **Host `23276`, supervisor `11116`**, health true, Cloudflare Gateway HTTP 200.
- Не потребовались ни ручное вмешательство, ни откат.

| Файл | Установленный SHA-256 | Проверка |
|---|---|---|
| `gui.mjs` | `cc41e304af9757ccda180f71099e9c12ba41f969616e7f37570c9ee9d9fb361f` | PASS |
| `uia-script.mjs` | `7384a1e8edb8762cf4ec540f5602a8a5696f15a1f94b5b504746475df53011aa` | PASS |

**Дополнительно:** после живого E2E SHA-256 всех шести runtime-файлов `gui`, `uia-script`, `consent`, `windows`, `apps`, `procs` совпали с закреплёнными кодовыми коммитами — **6/6 PASS**. NX-13, NX-19 и NX-21 не были перезаписаны.

## 3. Реальный E2E с установленного NEXUS — PASS

- Включена встроенная демонстрация экрана `watch_nexus` на телефон.
- Открыта NEXUS-owned «Таблица символов» `charmap PID 18400`, затем NEXUS-owned «Сведения о системе» `msinfo32 PID 17904`.
- После чтения актуальных окон был выполнен `focus_window({pid:17904})`, который вернул **focused=true**, `method=titlebar_click`, HWND **1050146**.
- `focus_window({pid:18400})` на перекрытой «Таблице символов» дал **`focused=false`, `cause=titlebar_occluded`**, `occlusion.verified=true`, `probes=3`, `blockedBy=[{hwnd:1050146,pid:17904,process:"msinfo32"}]`.
- `UIA.SetFocus` ранее вернул `MethodInvocationException`; все три `titlebar_probe` отказали с `nativeVerified=true`. **Никаких кликов по чужому/перекрывающему окну при отказе не совершено.**
- По проверенному экрану NEXUS нажал лишь системную кнопку **сворачивания** собственного окна `msinfo32`: `mouse_action(click,x:1106,y:64)` → `done:true,target:msinfo32,foregroundAfter:charmap`.
- `window_info` и `focus_window({pid:18400})` подтвердили восстановление фокуса: `focused=true,already=true`, HWND `590634`.
- После подтверждения результата окно `charmap PID 18400` и окно `msinfo32 PID 17904` закрыты штатно через `close_window` с `closed=true,by=nexus_owned`. Проверка `list_windows`: оба отсутствуют.

## 4. Сохранившиеся ограничения

- **Результат NX-26 относится к диагностике перекрытия и безопасному восстановлению фокуса.** Защищённые `Control Panel`, `ApplicationFrameHost`, `csrss` и их ограничения не изменялись; обход не проводился.
- При неоднозначности Win32/UIA код сохраняет `titlebar_not_reachable` (проверено локальными регрессионными тестами); это безопасное поведение, а не разрешение на действие.
- `main`, Gateway, `power`, политики безопасности, службы и задачи Планировщика не менялись.
- Ранее пройденные реальные NX-13, NX-19, NX-21 не повторялись.

**Итоговый чекпоинт:** код `2f80548`; документация и ACTIVATE до установки `1726877`; данный документ фиксирует фактическую установку и реальную приёмку. Дальнейшая работа NX-03 — независимый этап, без повторения успешных NX-13/19/21/26.
