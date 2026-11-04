# ACTIVATE — NEXUS 0.6.1b (исправления 04.11.2026 после HTTP 530) — для локального Claude Code на ПК

**Разрешение владельца:** 04.11.2026 ~10:59 («Да исправляй») — установка исправлений, автозапуск при входе, удаление `owner-passphrase.txt`.
**Сборка:** ветка `experiment/nexus-0.5.2-owner-access-20261102`, коммит — см. `NEXUS-NEXT-0.6.1-REPORT.md` («0.6.1b»); файлы и SHA-256 — `MANIFEST-NEXT-0.6.1.sha256`.
**Сейчас на ПК:** Host 0.6.1-next (`a6457b6`) — **не запущен** с ~09:37 UTC (убит извне, см. отчёт); Gateway `09236bfe-0eae-4971-b961-c4153e12adad`. `power` под запретом владельца (`ownerBans:["power"]`) — **не трогать**.
**Ошибки и откат:** «Правило ошибок и отката» из `ACTIVATE-NEXT-0.6.0.md`. Не менять: Smart App Control / Defender / UAC / BitLocker / Firewall, `main`, чужие окна и документы.

## Что исправлено
1. Host сам поднимается после сбоя или завершения извне: `nexus-supervisor.mjs` (скрытый, без окна) проверяет `/healthz` каждые 20 с и перезапускает Host; Host в свою очередь перезапускает погибший supervisor. Автозапуск при входе владельца — задача `NEXUS-Host-Logon` (запускает supervisor). Полностью выключить — кнопка «⏻ Выключить NEXUS» на `/live` или «выключи NEXUS» в чате (`live_control host_off`); включить — задача `NEXUS-Host-Run`.
2. Туннель не роняет Host: при выходе cloudflared — перезапуск с паузой 2→60 с и перерегистрация; при ≥4 сбоях QUIC за 15 мин — переход на `--protocol http2` (запоминается в `tunnel-protocol`).
3. Подтверждения владельца подписываются ключом шлюза (Ed25519, хранится только в Cloudflare KV, создаётся шлюзом сам); Host принимает `owner_decide` только с действующей подписью (публичный ключ — `GET /owner-pub`). `wrangler deploy/secret/rollback/delete/login` с ПК — в списке владельца.
4. `start` и `capabilities_migrated` пишутся в audit.log; вывод PowerShell/cmd с кириллицей декодируется (OEM-кодировка); тест `rm` работает и без Git `usr\bin`.

## A. Исходники и проверка
1. `git -C Documents\NEXUS\_src-0.5.2 fetch origin experiment/nexus-0.5.2-owner-access-20261102` → `git worktree add --detach Documents\NEXUS\_src-next-0.6.1b <коммит>`; `rev-parse HEAD` совпадает.
2. Манифест (как в 0.6.1) → пусто. Тесты Host (без `*-real`) → 0 fail; шлюз → 0 fail.

## B. Бэкап → `Documents\NEXUS\_backup-0.6.1b-pre-<дата>`
Программные файлы рабочей папки Host (`*.mjs`, `NexusRobot.java`, `sentinel\`, `install\`) и из `%USERPROFILE%\.nexus-host`: `capabilities.json`, `tasks\`, `plans\`, `owner-stop.json` (если есть); `SHA256.txt`. Шлюз: `src\*.mjs`.

## C. Host
1. Убедиться, что Host не запущен (`/healthz` не отвечает; процессов `node … nexus.mjs` нет). Если запущен — остановить штатно (`DELETE /tunnel`, затем процесс).
2. Скопировать все файлы раздела `nexus-host/` манифеста (новый: `nexus-supervisor.mjs`). `capabilities.json` не трогать.

## F. Шлюз (до запуска Host — Host берёт с него публичный ключ)
1. `npx wrangler deployments list` → записать Version ID. Скопировать `nexus-gateway/src/*.mjs` (изменены `handlers.mjs`, `live-page.mjs`, `catalog.mjs`); тесты сборки → `test\`. `node --test test\*.test.mjs` → 0 fail. `npx wrangler deploy`.
2. `GET https://nexus-gateway.entoni441.workers.dev/owner-pub` → `{"alg":"Ed25519","x":"…43 символа…"}` (первый вызов создаёт ключ); второй вызов → тот же `x`. `/health` ok.

## C (продолжение). Запуск и автозапуск
3. Запуск: `Start-ScheduledTask NEXUS-Host-Run` → `/healthz` = `0.6.1-next`. В `audit.log` есть `start`; в `tunnel.log` — `tunnel_start`, `registered startup`; через ~10 с — `supervisor_started`, затем `supervisor daemon up`. Файлы `host.pid`, `supervisor.pid` в `.nexus-host`.
4. Автозапуск при входе: в `install\NEXUS-Host-Logon.xml` подставить `__USER__` (`whoami`), `__NODE__` (полный путь node.exe, как в `NEXUS-Host-Run`), `__HOSTDIR__` (рабочая папка Host); сохранить UTF-16; `schtasks /Create /TN "NEXUS-Host-Logon" /XML <файл> /F` (без `/RU`/`/RP`, без прав администратора). Если раньше такая задача была — заменяется.
5. Проверка самовосстановления (безопасно): завершить процесс Host (`taskkill /pid <host.pid> /t /f`) → в течение ≤60 с `/healthz` снова отвечает, новый PID в `host.pid`, в `tunnel.log` строки `supervisor … starting host`; окна консоли не появилось. Затем завершить процесс supervisor (`supervisor.pid`) → ≤70 с новый `supervisor.pid` (Host перезапустил его).
6. Smoke (read-only): `tools/list` → 43; `get_capabilities` → `ownerBans:["power"]` (без изменений); `run_command powershell ["-NoProfile","-Command","Get-Date"]` → дата по-русски читается; `owner_consents` напрямую без подписи можно, `owner_decide` без подписи → `invalid_args`, с поддельной → `owner_signature_invalid` (подписывать за владельца нельзя и не нужно).
7. `live_control` (через Host) → `status` работает; `host_off` **не вызывать** (выключит NEXUS — это проверит владелец сам при желании).

## G. Пароль владельца на диске
`%USERPROFILE%\.nexus-host\owner-passphrase.txt` — пароль `/live` открытым текстом, Host и шлюзу не нужен. Удалить файл (не в корзину NEXUS): `Remove-Item -LiteralPath "$env:USERPROFILE\.nexus-host\owner-passphrase.txt"`. Содержимое не читать и не выводить. `owner-passphrase.sha256` оставить.

## Откат
- Host: остановить supervisor (`supervisor.pid`) и Host → файлы из B → удалить `nexus-supervisor.mjs`, `host.pid`, `supervisor.pid`, `tunnel-protocol` → `schtasks /Delete /TN "NEXUS-Host-Logon" /F` → `NEXUS-Host-Run`.
- Шлюз: `npx wrangler rollback <Version ID из F.1>`. (Ключ `owner_sign` в KV остаётся — безвреден.)

## Отчёт → `windows-pc-agent-lab/NEXUS-NEXT-0.6.1b-INSTALL-REPORT.md`
Шаг / факт / PASS-FAIL; HEAD; PID Host и supervisor до/после проверки C.5; версия шлюза до/после; строки `tunnel.log` о запуске и перезапуске (без URL).
