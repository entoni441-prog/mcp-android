# NEXUS NX-03 — интеграция, установка и реальная приёмка

**Дата:** 06.11.2026 Europe/Rome (05.11.2026 UTC).
**Результат:** INTEGRATION PASS / INSTALL PASS / REAL DISCOVERY + REUSE LAUNCH PASS.
**Ограничение:** отдельно не проверялся cold start ChatGPT после полного закрытия пользовательской сессии.

## Чекпоинты

- Исходная установленная база: NEXUS 0.6.1d + NX-13/19/21/26 (NX-26 принят `fb43ef6`).
- Рабочая ветка: `experiment/nexus-nx03-integrated-20261106`; создана поверх принятой NX-26, **не** поверх исторической непринятой 0.6.1e.
- Исправление: cherry-pick `980f458` → immutable code commit `73b487ed49f8fc59210e99346ae6bb2d3fac5169`.
- CI-trigger `06a8cbbbe8fbc8a264da0ba184b3ebba026c55c8`.
- GitHub Actions [run 42131836638](https://github.com/entoni441-prog/mcp-android/actions/runs/42131836638): **Windows / Linux / Gateway 3/3 PASS**.
- Локально `node --test stage2-052.test.mjs windows-discover-real.test.mjs`: **10 PASS / 0 FAIL / 1 SKIP**; дополнительные `consent/windows/gui`: **53 PASS / 0 FAIL / 1 SKIP**.
- Изменение кода ограничено `nexus-host/discover.mjs` и регрессионным тестом `stage2-052.test.mjs`. CI branch trigger обновлён только для experiment.

## Предварительная реальная проверка

Отдельный импорт экспериментального `createDiscovery().list(true)` на Windows владельца до установки вернул каталог из 49 приложений за ~1,7 секунды. `chatgpt` обнаружен по AppX/Store manifest, `cls=agent`, реальный путь `ChatGPT.exe` существует; `launchableExe=true`, `appGate(mode=focus).allow=true`.

## Установка

- Владелец дал поручение «Окей, начинай» в ответ на маршрут с интеграцией, установкой и реальной приёмкой. Дополнительных изменений в `main`, Gateway, security, `power` не делалось.
- Регламент: `ACTIVATE-NX03-0.6.1e-20261106.md`; manifest: `MANIFEST-NX03-0.6.1e-20261106.sha256`.
- Резервная копия **одного** файла: `C:\Users\krado\Documents\NEXUS\_backup-nx03-061e-pre-20261105T234936Z` — SHA-256 и размер PASS.
- Отдельный автономный установщик `C:\Users\krado\Documents\NEXUS\_activate-nx03-061e-20261106.mjs` прошёл `node --check` и `--check` (PREFLIGHT_PASS), затем остановил только подтверждённые Host PID `23276` и supervisor PID `11116`.
- Заменён **только** `nexus-host/discover.mjs`; SHA-256 после установки: `6a4136e0d0d12b8bdedc8a79edb5213c23d2428951e232c32c954e1575b4090d`.
- Durable installer state: `_activate-nx03-061e-20261106-state.json`, `installed_verified` в 2026-11-05T23:51:14Z. Восстановлены Host PID **23324**, supervisor PID **20656**, health true. Cloudflare tunnel/Gateway после переподключения HTTP **200**. Rollback не потребовался.
- Контроль после испытания: **7/7 runtime SHA-256 PASS** против закреплённых коммитов (NX-03, NX-26, NX-13/19/21).

## Реальный Windows E2E через установленный NEXUS

1. `watch_nexus` → `state=active,granted=true,streaming=true` (демонстрация экрана на телефон).
2. До действия `manage_app_access({action:'list'})` показал `chatgpt`, `name=ChatGPT`, `cls=agent` среди **49** обнаруженных приложений. Это устраняет исходный `app_not_found`.
3. Исходный пользовательский ChatGPT: главное окно `PID 15208`, `ownedByNexus:false`; остальные процессы ChatGPT также не принадлежали NEXUS.
4. `open_app({app:'chatgpt'})` → **`started:true`, `via:'discovered'`, launch PID `20760`, `createdByNexus.windows=[]`, `tabs=[]`**. Никакого присвоения существующего окна.
5. После вызова `list_windows` подтвердил существующее окно `ChatGPT PID 15208`, `window_info` → `foreground:true`, `Chrome_WidgetWin_1`; `list_processes` показал все процессы ChatGPT как `ownedByNexus:false`. Чужие окна не закрывались, сообщения в чат не отправлялись, авторизация не изменялась.
6. **Не проверено:** полный cold-start после завершения всех пользовательских процессов ChatGPT. Для него понадобилось бы закрывать текущую владельческую сессию, чего этот тест сознательно не делает.

- После restart Windows создал новое окно WindowsTerminal PID 20196 с заголовком `C:\Program Files\nodejs\node.exe`. Оно адресно идентифицировано по PID/времени создания и снова свёрнуто (`minimized=true`); Host не остановлен.

## Границы и итог

NX-03 **PASS** для обнаружения установленного ChatGPT, штатного повторного запуска/активации и fail-closed ownership существующего окна. Cold-start — отдельно НЕ ПРОВЕРЕН, не выдавать за полный E2E. NX-13/19/21/26 сохранены; их повторные испытания не проводились. Окно Windows Terminal «NEXUS Host» перед этапом было **свёрнуто**, сам Host не остановлен до предусмотренного установкой restart. Другие программы и документы владельца не изменялись.

**Дальше:** не повторять подтверждённые тесты. При необходимости cold-start — отдельная приёмка только после согласования закрытия пользовательской сессии.
