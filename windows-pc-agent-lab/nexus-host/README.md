# NEXUS Host — локальный MCP-сервер для Windows (этап 1)

**Статус 01.11.2026:** v0.1.0 запущен на личном Windows 11 (SAC не сработал), 6/6 инструментов PASS через локальный MCP-вызов, Блокнот открыт. v0.2.0: добавлен режим Cloudflare Access JWT, тесты 12/12. Канал к ChatGPT (этап 2) ещё не развёрнут.

## Почему так, а не v3-очередь в D1
- ChatGPT нативно подключает **удалённые MCP-серверы** (developer mode). Своя подписанная очередь задач в D1 дублирует то, что даёт MCP, и упёрлась в блок публикации.
- Smart App Control блокирует скачанные из интернета `.cmd/.bat/.ps1/.js/.dll` ([список Microsoft](https://support.microsoft.com/en-US/Windows/Security/Threat-Malware-Protection/smart-app-control-has-blocked-an-app-with-a-dangerous-file-extension)). Блокировался **обёрточный `.cmd`**, а не Node.
- PowerShell под App Control выполняет недоверенные скрипты в **Constrained Language Mode** ([Microsoft](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/design/script-enforcement)) — UIA через .NET из `.ps1` там, скорее всего, не заработает (гипотеза, проверить).
- Поэтому: **один `.mjs`, ноль npm-зависимостей и нативных модулей**, запуск подписанным `node.exe`. Защита Windows не отключается и не обходится — нечему блокироваться.

## Модель безопасности
- слушает только `127.0.0.1`; токен генерируется локально (`%USERPROFILE%\.nexus-host\token.txt`), сравнение константное по времени;
- проверка `Origin` (защита от DNS-rebinding), лимит тела 64 KiB, без batch;
- фиксированный набор инструментов, файловые — только внутри `%USERPROFILE%\NEXUS-workspace` (переиспользован проверенный `v3/actions.mjs`), без shell;
- аудит каждого вызова в `.nexus-host\audit.log` (без токена); STOP = закрыть окно / Ctrl+C; автозапуска нет.

## Запуск на Windows (этап 1 — локальная проверка)
```
node -v
node windows-pc-agent-lab\nexus-host\server.mjs
```
Файлы лучше получить через `git clone` (без пометки «из интернета»); `.mjs` в любом случае не входит в список блокировок SAC.

## Инструменты
`get_status`, `list_dir`, `read_text`, `make_dir`, `write_text`, `open_app` (notepad/calculator). Расширение (окна/UIA, браузер через Playwright, процессы) — после подтверждения этапов 1–2.

## Этап 2 — канал ChatGPT
Вариант A (рекомендован): ChatGPT → `https://nexus.<домен>/mcp` → Cloudflare Access (**Managed OAuth**, политика: только email владельца) → Cloudflare Tunnel → `127.0.0.1:8765/mcp`. Свой OAuth-код не нужен; сервер проверяет `Cf-Access-Jwt-Assertion` (RS256, iss, aud, exp, email) при наличии `%USERPROFILE%\.nexus-host\access.json`:
```json
{"teamDomain":"<team>.cloudflareaccess.com","aud":"<AUD tag приложения Access>","allowedEmails":["<email владельца>"]}
```
Требования Cloudflare: домен (zone) в аккаунте для публичного hostname туннеля; Zero Trust Free требует ввести платёжные данные при онбординге (списаний нет).

Вариант B (без домена и карты): Worker на workers.dev с OAuth по образцу Chat Router + quick tunnel; больше собственного кода, URL туннеля меняется при перезапуске.
