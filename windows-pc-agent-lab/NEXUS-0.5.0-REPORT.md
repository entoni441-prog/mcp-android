# NEXUS 0.5.0 — отчёт Claude (code-complete, на ПК НЕ установлено)

Ветка `experiment/nexus-0.5.0-unified-20261101`. Код: `092f5e4` + `c6fed8d` (тест/документы). CI run **41350444166**: host Windows ✔ (86 pass, реальные Notepad/UIA/Java), host Ubuntu ✔ (Xvfb Robot, Chrome), gateway ✔ (unit, Python MCP client, Playwright, wrangler dry-run).
Инструментов: **35** (модель видит 34; `live_frame` — только для виджета).

## Готово
**Live View A — виджет в чате (MCP Apps).** Ресурс `ui://nexus/live-view-v1.html` (`text/html;profile=mcp-app` + ключи OpenAI). Инструмент `watch_nexus` открывает виджет; кадры виджет берёт сам через app-only `live_frame` по тому же OAuth-соединению — у виджета нет токена, URL ПК и внешних доменов (CSP пустой). Inline / PiP / fullscreen — запрос у хоста, если он их объявил. Пауза, 0.5–4 к/с, STOP (выключает `live_view` на ПК), кнопка «попросить включить».
**Live View B — `https://<шлюз>/live`.** Вход паролем владельца через тот же Durable Object (общая блокировка 5/15 мин, nonce раздельны с OAuth), cookie `__Host-` HttpOnly/Secure/SameSite=Strict 30 мин, HMAC от NEXUS_TOKEN (новых секретов нет; `LIVE_SESSION_EPOCH` отзывает все сессии). Кадр проксируется шлюзом, `no-store`; STOP с CSRF-заголовком.
**Источник кадров.** Java: JPEG + нарисованный курсор (реальные координаты; проверено на Xvfb и Windows CI). Capability `live_view` (по умолчанию off, отдельно от `gui_input`); кадр только по запросу зрителя; ≤5 захватов/с общих для всех зрителей; кадры не пишутся в audit; индикатор в окне Host и в заголовке окна.
**Приложения.** `manage_app_access`: request → consent_required → confirm_action allow → `inputApps`/`launchApps` (атомарная запись). HARD_DENY расширен менеджерами паролей. `open_app` любого выданного приложения (фиксированный .exe, без аргументов и shell).
**Блокнот.** `open_app notepad` всегда открывает НОВЫЙ пустой документ `.nexus-scratch/NEXUS-<token>.txt`; владение — только по токену в имени. Закрывает дефект 01.11 (восстановленные вкладки владельца). Проверено на реальном Windows CI.
**Защита данных.** `inspect_ui` по умолчанию скрывает текст Document/Edit (только длина); `includeText=true` — по необходимости. `focus_window` возвращает фактический HWND.
**Браузер.** `browser_tabs` (list/new/switch/close), `browser_action` wait (загрузка/текст), select; клик/Enter по «купить/оплатить/отправить/удалить/подтвердить…» → consent_required. Проверено в реальном Chrome/Edge (CI).
**Связь.** `connection_status` отвечает шлюз даже при офлайн-ПК: регистрация, проба `/healthz`, вердикт Host по событиям cloudflared (`idle_timeouts_recovered` для «no recent network activity»), шаг восстановления. Trace id в шлюзе, audit ПК и тексте ошибок. 401 от Host → `host_401_token_mismatch`.

## Не проверено / ограничения (факт)
1. **Виджет в настоящем ChatGPT (веб и Android) не проверен** — проверка только на ПК владельца после установки. Неизвестно: вызывает ли клиент app-only `live_frame` из виджета через наш коннектор, пропускает ли CSP `data:`-изображения, есть ли PiP на Android. Если нет — работает вариант B.
2. Каждый кадр = 1 запрос Worker + 1 чтение KV. Бесплатный лимит Workers/KV ≈100 тыс./сутки → при 2 к/с ≈ 13 ч просмотра в сутки. Платные тарифы не нужны и не подключались.
3. Согласие (закрытие, выдача приложений, необратимые действия в браузере) проходит через ChatGPT: Host не может доказать, что нажал человек. Защита — точная метка цели в Always-ask + журнал.
4. Авторизованный профиль браузера владельца не используется (CDP к нему = доступ к cookies). Безопасная граница: постоянный отдельный профиль NEXUS — владелец сам один раз входит в нужные сайты в окне NEXUS; NEXUS cookies не читает.
5. Несколько мониторов — ввод по-прежнему отказывает; Live View показывает основной экран.

## Поставка
14 файлов: `MANIFEST-0.5.0.sha256`. Установка: `ACTIVATE-0.5.0.md` (бэкап → Host smoke → только при PASS deploy шлюза → коннектор → откат). Приёмка: `NEXUS-0.5.0-ACCEPTANCE.md`.
Откат: файлы из `_backup-0.4.3-20261101`, шлюз — `wrangler rollback b62e256b-3e22-4f73-81ae-f19fe89d69aa`.
