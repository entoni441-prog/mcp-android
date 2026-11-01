# NEXUS Gateway — развёртывание (вариант B), по фазам

Цепочка: **ChatGPT → `https://nexus-gateway.entoni441.workers.dev/mcp` (OAuth + пароль владельца) → quick tunnel → NEXUS Host на ПК**.
Бесплатно: Workers Free + KV + SQLite Durable Object + quick tunnel; без домена и карты.

Для локального агента (Claude Code на ПК), папка `%USERPROFILE%\Documents\NEXUS\nexus-gateway`.
**Правила:** не выводить `token.txt`, `owner-passphrase.txt` и секреты; трогать **только** Worker `nexus-gateway`
(в аккаунте уже есть 7 других — `chat-router-*`, `pc-agent-readonly-lab`, `consilium-*`, `mailru-mcp`, `agy-bridge-mvp` — их не менять);
повторный `wrangler login` — только если `npx wrangler whoami` не показывает доступ; защиту Windows не отключать.

## Фаза 1 — изолированный Worker, туннель НЕ открывать
1. `npm install --no-audit --no-fund`
2. `npx wrangler whoami` → если не авторизован: `npx wrangler login`.
3. Предпроверка: `npx wrangler deployments list --name nexus-gateway` должен сообщить, что Worker не найден. Если найден — STOP, сообщить.
4. `npx wrangler kv namespace create OAUTH_KV` → вписать `id` в `wrangler.toml` вместо `REPLACE_WITH_KV_ID`.
5. `node make-owner-passphrase.mjs`, затем (значения не печатать):
   ```powershell
   Get-Content "$HOME\.nexus-host\token.txt" -Raw | npx wrangler secret put NEXUS_TOKEN
   Get-Content "$HOME\.nexus-host\owner-passphrase.sha256" -Raw | npx wrangler secret put OWNER_PASSPHRASE_SHA256
   ```
   Если wrangler предложит создать Worker для секрета — согласиться (имя `nexus-gateway`).
6. `npx wrangler deploy` (создаёт Durable Object `ConsentGuard` по migration `v1`).
7. Проверки (все обязательны):
   - `GET /health` → 200 `{"ok":true,"service":"nexus-gateway"}`
   - `POST /mcp` без OAuth-токена → **401**
   - `GET /.well-known/oauth-authorization-server` → 200 JSON с `authorization_endpoint`, `token_endpoint`, `registration_endpoint`
   - `POST /tunnel` без токена → **401**; `GET /authorize` без параметров → 400 (не 500)
8. **Не** создавать `gateway.json` и **не** запускать `nexus.mjs`.

## Фаза 2 — подключение ChatGPT (владелец, вручную), ПК всё ещё закрыт
- Сохранить пароль из `%USERPROFILE%\.nexus-host\owner-passphrase.txt` в Bitwarden, удалить файл.
- ChatGPT → Настройки → Приложения → Developer mode → Create: URL `https://nexus-gateway.entoni441.workers.dev/mcp`, Authentication: OAuth.
- Страница NEXUS: ввести пароль → «Разрешить».
- Ожидаемо: коннектор подключён, но вызов инструментов возвращает `pc_offline` — это **правильно**: туннеля нет.

## Фаза 3 — открыть ПК (только после PASS фаз 1–2)
- `%USERPROFILE%\.nexus-host\gateway.json`: `{"url":"https://nexus-gateway.entoni441.workers.dev"}`
- `cloudflared`: если нет — `winget install --id Cloudflare.cloudflared -e`.
- Остановить старый `server.mjs` (Ctrl+C), запустить `node "$HOME\Documents\NEXUS\nexus-host\nexus.mjs"` → `ChatGPT access: ON`.
- В ChatGPT: `get_status`, затем `open_app notepad`.

## Защита
- OAuth (PKCE S256) — `@cloudflare/workers-oauth-provider`; токен ChatGPT живёт 1 ч.
- Страница согласия: пароль владельца (144 бит). Блокировка: 5 ошибок → 15 мин; счётчик, проверка и одноразовый nonce — **в одном атомарном вызове Durable Object** (не KV).
- ПК: Bearer-токен между шлюзом и NEXUS Host; без туннеля ПК недоступен.
- STOP: закрыть окно `nexus.mjs` → туннель снят, ChatGPT получает `pc_offline`.
