# NEXUS Host — локальный MCP-сервер для Windows (этап 1)

**Статус 01.11.2026:** код + тесты PASS на Linux (7/7) и совместимость с официальным MCP-клиентом (Python SDK 2.3.0) подтверждена. **На личном Windows не запускался.** Канал к ChatGPT (этап 2) ещё не построен.

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

## Этап 2 (следующий)
ChatGPT → Cloudflare Worker с OAuth (тот же паттерн, что уже работает у Chat Router) → Cloudflare Tunnel (`cloudflared`, подписан, бесплатен, только исходящее соединение) → `127.0.0.1:8765/mcp`.
