# NEXUS Gateway — развёртывание (вариант B)

Цепочка: **ChatGPT → `nexus-gateway.<sub>.workers.dev/mcp` (OAuth + пароль владельца) → quick tunnel → NEXUS Host на ПК**.
Бесплатно: Workers Free + KV + quick tunnel; без домена и без карты.

Инструкция для локального агента (Claude Code на ПК). Папка: `%USERPROFILE%\Documents\NEXUS`.
**Правила:** не выводить содержимое `token.txt`, `owner-passphrase.txt` и секретов; не трогать другие Worker'ы
(`chat-router-*`, `pc-agent-readonly-lab`); защиту Windows не отключать.

1. `cloudflared`: если нет — `winget install --id Cloudflare.cloudflared -e` (подписан Cloudflare).
2. `cd nexus-gateway` → `npm install --no-audit --no-fund`.
3. `npx wrangler login` — владелец подтверждает вход в браузере. `npx wrangler whoami` — проверить аккаунт.
4. `npx wrangler kv namespace create OAUTH_KV` → вписать полученный `id` в `wrangler.toml` вместо `REPLACE_WITH_KV_ID`.
5. Пароль владельца: `node make-owner-passphrase.mjs`. Затем секреты (значения не печатать):
   ```powershell
   Get-Content "$HOME\.nexus-host\token.txt" -Raw | npx wrangler secret put NEXUS_TOKEN
   Get-Content "$HOME\.nexus-host\owner-passphrase.sha256" -Raw | npx wrangler secret put OWNER_PASSPHRASE_SHA256
   ```
   (Если wrangler попросит создать Worker для секрета — согласиться: имя `nexus-gateway`.)
6. `npx wrangler deploy` → URL вида `https://nexus-gateway.<sub>.workers.dev`. Проверка: `GET <URL>/health` → `{"ok":true}`.
7. Записать `%USERPROFILE%\.nexus-host\gateway.json`: `{"url":"https://nexus-gateway.<sub>.workers.dev"}` (без `/` в конце).
8. Остановить старый `server.mjs` (Ctrl+C в его вкладке), запустить в отдельной вкладке: `node "$HOME\Documents\NEXUS\nexus-host\nexus.mjs"` → дождаться `ChatGPT access: ON`.
9. Проверка извне: `POST <URL>/mcp` без OAuth-токена → **401** (шлюз закрыт для чужих).

## Владелец (вручную, один раз)
- Открыть `owner-passphrase.txt`, сохранить пароль в Bitwarden, удалить файл.
- ChatGPT → Настройки → Приложения/Connectors → Developer mode → **Create**: URL `https://nexus-gateway.<sub>.workers.dev/mcp`, Authentication: **OAuth**.
- На странице NEXUS ввести пароль владельца → «Разрешить».

## Ограничения
- Адрес quick tunnel меняется при каждом запуске — `nexus.mjs` сам регистрирует новый; ChatGPT-коннектор не меняется.
- Quick tunnel — сервис Cloudflare без SLA; ПК должен быть включён и `nexus.mjs` запущен.
- STOP: закрыть окно `nexus.mjs` или Ctrl+C — туннель снимается, доступ из ChatGPT прекращается (`pc_offline`).
