# NEXUS Gateway — встроенные подтверждения в ChatGPT Live: production rollout
Дата: 2026-11-07, Europe/Rome. Статус: GATEWAY DEPLOY PASS, HTTPS SMOKE PASS; ANDROID CHATGPT OWNER UI ACCEPTANCE PENDING.

## Авторизация и выполненный план
- Пользователь отдельно разрешил обновить **только рабочий Cloudflare Gateway**, не меняя Windows, Host, безопасность, main.
- Для NEXUS owner-only operation на внешней /live был предъявлен единый двухшаговый план SHA-256 `1f0a6cd4e98efd31d00728b4023e371e3b3c75ebc992e106e183b8de23ed00e8`; владелец нажал «Разрешить», подтвердил это в чате, вызов `confirm_action` вернул `confirmed:true`.
- Команда `command_plan.run` завершила оба шага: `wrangler deploy --dry-run` exitCode **0** (2026-11-07T06:27:08Z); `wrangler deploy` exitCode **0** (2026-11-07T06:27:23Z). План state `finished`, next 2/2.
- Прежняя production версия Worker: `18912975-a18d-40ba-aa51-017411939140`. Новая версия, подтверждённая Cloudflare API: **`8e3735e6-eb73-4e42-9710-f0ea63214b8c`**, deployment `b4166de7-f419-4fd7-ab0d-3026988e718b`, трафик **100%**. Предыдущая версия остаётся известным кандидатом для rollback.

## Что изменилось
- В каталог действующего Gateway добавлены `src/widget-consent.mjs`, отдельные хранилища nonce в `src/guard-core.mjs`, новые методы `src/guard.mjs`, маршруты `src/handlers.mjs`, расширенный Live widget `src/widget.mjs`.
- В `src/widget.mjs` встроенная панель «Подтверждения владельца» показывает заявки и требует новую авторизацию паролем **NEXUS владельца** для просмотра/каждого решения. Пароль не передаётся LLM и MCP tools, а передаётся по HTTPS напрямую Gateway, проверяется общим ConsentGuard с атомарным одноразовым nonce и 5-fail lockout. Подтверждения подписываются через прежнюю Ed25519 схему Host.
- Встроенный Live дополнен честным read-only индикатором `HOST_ONLINE`/`HOST_OFFLINE`; Windows pre-logon PIN UI и удалённый Winlogon по-прежнему НЕ реализованы.
- Production `wrangler.toml`, секреты, OAuth настройки, Host, Windows и main не изменялись. У файлов рабочего Gateway сохранены backup копии (4 заменённых файла); ранее отсутствовавший новый `widget-consent.mjs` создан отдельно.

## Проверки после публикации
- Cloudflare API: новая версия `8e3735e6-eb73-4e42-9710-f0ea63214b8c` = 100% traffic.
- `GET /health` → HTTP **200**.
- `POST /mcp` без OAuth token → HTTP **401**.
- CORS preflight для `https://nexus-test.web-sandbox.oaiusercontent.com` → HTTP **204**, allow-origin только точный origin, methods `POST, OPTIONS`.
- `GET /live/widget/challenge` без POST/специального заголовка → HTTP **403**.
- CORS request from `https://attacker.invalid` → HTTP **403**, без `Access-Control-Allow-Origin`.
- Некорректная операция `POST /live/widget/challenge` → HTTP **400**, `invalid_operation`. Реальный пароль владельца не использовался; никаких R3 заявок искусственно не создавалось.
- `connection_status` → `online`, tunnel probe HTTP **200**, Host `reachable`; Host PID **22604**, версия `0.6.1-next` без перезапуска.
- До выкладки unit/integration suite **44/44 PASS**, CI Windows+Linux `42346090018` обе успешны, Wrangler dry-run обе успешны. Локальная production compatibility suite **27/27 PASS**.
- В чат вызван `watch_nexus`, встроенная Live панель показана как UI. **Наличие новой панели на мобильном устройстве, правильная фактическая iframe Origin, возможность ввода passphrase внутри неё и реальное owner-only подтверждение не проверены владельцем; НЕ считать PASS**.

## Точки останова
1. Попросить владельца посмотреть встроенную Live панель в текущем чате Samsung; подтвердить появление «Подтверждения владельца». Старый ChatGPT client может держать кэш UI resource; не менять Host и не выполнять неконтролируемые повторные deploy.
2. Затем безопасный тест с реальным ожидающим безвредным подтверждением только по отдельному разрешению: пароль вводится исключительно в Owner field inline widget, не в чат; проверить что авторизация / signed decision доходит до Host.
3. В случае отсутствия панели или ошибочной iframe CORS собрать точное наблюдение и исправить в экспериментальной ветке. Не подменять тест UI утверждением по CI.
4. Независимый pre-logon remote Windows sign-in остаётся заблокированным; `logonChannelVerified=false`. Никакой Windows reboot без доверенного удалённого логина.
