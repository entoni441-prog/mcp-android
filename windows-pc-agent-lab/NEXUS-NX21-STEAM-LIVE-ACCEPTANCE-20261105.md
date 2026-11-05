# NEXUS NX-21 — живой тест Steam и демонстрация экрана

**Дата:** 05.11.2026. **Среда:** Windows владельца, NEXUS Host 0.6.1d с установленным NX-13 hotfix `4cfc360`. **Ветка:** `experiment/nexus-0.6.1d-20261105`.

## Результат

**PASS** — защита уже запущенного неприсвоенного Steam от ошибочного присвоения и закрытия.

**BLOCKED (ещё не проверен)** — строго отдельный сценарий Steam, **впервые запущенного лично владельцем** до входа NEXUS в сессию. Текущий экземпляр первоначально создан NEXUS в прошлой сессии, поэтому утверждать полный E2E «owner-launched Steam» нельзя.

## Что реально сделано

1. Включён `watch_nexus` — встроенная трансляция рабочего стола в чат на телефоне; Host вернул `state=active, granted=true, streaming=true`. Сохранён ранее подготовленный экран: неиспользуемые окна свёрнуты, не закрыты, Steam видим.
2. До запуска: `steam.exe PID 18008`, GUI `steamwebhelper.exe PID 8876`, окно «Войти в Steam», в обоих случаях `ownedByNexus=false`. Другие `steamwebhelper` также неприсвоенные. Аккаунт/пароль Steam не требуются.
3. `open_app({app:'steam'})` вернул `started=true`, запуск PID `20712`, **`createdByNexus.windows=[]`, `tabs=[]`**. Окно Steam осталось `PID 8876`. Не присвоено.
4. `close_window({pid:8876,title:'Войти в Steam',onUnsaved:'ask'})` вернул `status=consent_required`, `kind=window`, `target=steamwebhelper: окно «Войти в Steam»`, `approval=owner_phone` — фактического закрытия **нет**.
5. Запрос согласия **отменён** вызовом `confirm_action({decision:'cancel',target:'steamwebhelper: окно «Войти в Steam»'})`. Результат `cancelled=true`.
6. После отмены `window_info PID 8876` подтверждает существование окна; `list_processes` показывает `steam.exe PID 18008` и `steamwebhelper.exe PID 8876`, все `ownedByNexus=false`. `host_diagnostics`: `pendingConsents=0`.
7. Не выполнялись вход/регистрация Steam, завершение процесса, закрытие чужих окон, изменение `main`, Gateway, Host, runtime и политик. `power` не использовался.

## Граница приёмки и следующий шаг

Этот прогон **не** доказывает происхождение «Steam запущен владельцем», поскольку Steam продолжает работать с предыдущей NEXUS-сессии. Для финального отдельного E2E: владелец в удобное время самостоятельно завершает Steam (если это не нарушает его работу) и самостоятельно запускает его вновь; NEXUS фиксирует новый PID как baseline, выполняет один `open_app steam`, проверяет `createdByNexus.windows=[]`, пробует `close_window` без `ownerRequested`, отменяет согласие и проверяет сохранность процесса/окна. Самостоятельно закрывать текущий Steam ради этого теста запрещено без отдельного указания.

**Итог:** NX-21 guard PASS; owner-launched edge case BLOCKED. Не повторять успешные проверки без нового условия.
