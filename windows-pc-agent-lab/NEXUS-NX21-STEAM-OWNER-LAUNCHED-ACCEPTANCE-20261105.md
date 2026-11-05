# NEXUS 0.6.1d NX-21 — owner-launched Steam, финальная реальная приёмка

**Дата:** 2026-11-05 (время журнала NEXUS ~22:23 UTC). **Результат: FULL PASS для согласованного сценария owner-launched Steam.**

## Предусловие подтверждено

1. Владелец вручную завершил ранее работавший Steam. До нового запуска NEXUS `list_processes({nameFilter:"steam"})` возвратил **count=0**; `list_windows` не показывал Steam.
2. Владелец вручную запустил Steam с рабочего стола и сообщил «Стим запущен». Вызов NEXUS **до повторного open_app** показал:
   - `steam.exe`: **PID 21756**, `ownedByNexus:false`;
   - `steamwebhelper.exe` с окном **«Войти в Steam»**: **PID 464**, `ownedByNexus:false`;
   - окно входа сохранено, регистрация и ввод пароля не нужны.
3. Встроенный `watch_nexus({})` активирован: `state=active`, `granted=true`, `streaming=true`; экран транслировался в чат на телефоне. Остальные окна оставались свернутыми, не закрывались.

## Проверка безопасности — факты

1. `open_app({app:"steam"})`: **`started:true`**, `via:"discovered"`, служебный launch PID **21492**, `createdByNexus.windows=[]`, `createdByNexus.tabs=[]`. Существующее окно не присвоено.
2. После open_app: Steam PID **21756** и окно `steamwebhelper` PID **464** сохранились, все `ownedByNexus:false`; новых пользовательских окон Steam не обнаружено.
3. `close_window({pid:464,title:"Войти в Steam",onUnsaved:"ask"})` вернул `status:"consent_required"`, `kind:"window"`, `target:"steamwebhelper: окно «Войти в Steam»"`, `approval:"owner_phone"`. Фактического закрытия **не было**.
4. Не дожидаясь согласия, применено `confirm_action({consentId:"69b5d4724842",decision:"cancel",target:"steamwebhelper: окно «Войти в Steam»"})`: **`cancelled:true`**.
5. Контроль после отмены: `steam.exe PID 21756` и GUI `steamwebhelper PID 464` продолжают работать, `window_info({pid:464})` снова показывает окно «Войти в Steam», `ownedByNexus:false`, `pendingConsents=0`, Host PID **21640** с нормальным tunnel health.

## Вывод

**NX-21 FULL PASS.** Впервые в этой проверке подтверждён отдельный ранее заблокированный сценарий: Steam запущен **владельцем** после полного завершения старого экземпляра. NEXUS не присвоил существующий Steam повторным запуском и сохранил fail-closed на закрытии окна. Это реальная проверка Windows, а не только mock-test.

**Не делалось:** закрытие или завершение Steam, авторизация/регистрация, изменение runtime, Gateway, main, power, настроек безопасности или прав владельца. Предыдущие NX-13 и NX-19 не повторялись.

**Связанные чекпоинты:** первоначальный guard PASS — `7b60270`; NX-13 установлен и принят — `db9af2a`; code SHA установленного NX-13 hotfix — `4cfc360`.

**Дальше:** NX-21 не требует исправления/повторной установки. NX-03 и NX-26 — отдельные задачи.
