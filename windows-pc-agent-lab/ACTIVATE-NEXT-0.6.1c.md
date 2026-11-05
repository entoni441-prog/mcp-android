# ACTIVATE — NEXUS 0.6.1c (исправление C.5: `taskkill /t` убивал Host и supervisor вместе) — для локального Claude Code на ПК

**Разрешение владельца:** 05.11.2026 — исправить совместное завершение процессов; остальную работающую часть не трогать.
**Сборка:** ветка `experiment/nexus-0.5.2-owner-access-20261102`, коммит — см. `NEXUS-NEXT-0.6.1-REPORT.md` («0.6.1c»); SHA-256 — `MANIFEST-NEXT-0.6.1.sha256`.
**Меняются только** `nexus-host/nexus-supervisor.mjs` и `nexus-host/nexus.mjs`. Шлюз, `capabilities.json`, задачи Планировщика, `power` (запрет владельца) — **не трогать**.
**Причина:** на Windows процесс, запущенный с `detached`, всё равно записан потомком (ParentProcessId) — `taskkill /t` находил второй процесс через первый. Теперь supervisor и Host запускаются через короткий процесс-посредник, который сразу завершается: связь в дереве PID обрывается.
**Ошибки и откат:** «Правило ошибок и отката» из `ACTIVATE-NEXT-0.6.0.md`.

## A. Проверка
1. `git -C Documents\NEXUS\_src-0.5.2 fetch origin experiment/nexus-0.5.2-owner-access-20261102` → `git worktree add --detach Documents\NEXUS\_src-next-0.6.1c <коммит>`; `rev-parse HEAD` совпадает.
2. Манифест → пусто. Тесты Host (без `*-real`) → 0 fail.

## B. Бэкап
`nexus-supervisor.mjs`, `nexus.mjs` рабочей папки Host → `Documents\NEXUS\_backup-0.6.1c-pre-<дата>` + `SHA256.txt`.

## C. Замена и перезапуск
1. Записать текущие `host.pid`, `supervisor.pid`. Остановить **оба** по PID без `/t`: сначала supervisor (`taskkill /pid <sup> /f`), затем Host — штатно (`DELETE /tunnel`, затем `taskkill /pid <host> /f`); дочерний cloudflared завершить, если остался. `owner-stop.json`, `host-off` не создавать и не удалять.
2. Скопировать два файла; хэши = манифест.
3. `Start-ScheduledTask NEXUS-Host-Run` → `/healthz` `0.6.1-next`; в `tunnel.log` `supervisor_started launcher <pid>`, затем `supervisor daemon up (pid N)`.
4. Проверить разрыв дерева: `(Get-CimInstance Win32_Process -Filter "ProcessId=<supervisor.pid>").ParentProcessId` ≠ PID Host.

## C.5 Самовосстановление (обязательно оба варианта)
1. **Дерево Host:** `taskkill /pid <host.pid> /t /f` → supervisor жив (его PID не изменился); ≤60 с `/healthz` отвечает, новый `host.pid`, `supervised:true`; в `tunnel.log` `supervisor … starting host`.
2. **Дерево supervisor:** `taskkill /pid <supervisor.pid> /t /f` → Host жив (`/healthz` без перерыва, PID тот же); ≤70 с новый `supervisor.pid` (`supervisor_started`).
3. Без `/t` — как в 0.6.1b (уже PASS), повторять не нужно.
4. Кириллица: команда, которую ещё не запускали (защита от повтора), например `run_command powershell ["-NoProfile","-Command","(Get-Date).ToString('dddd', [Globalization.CultureInfo]'ru-RU')"]` → день недели по-русски читается.

## Откат
Остановить supervisor и Host по PID → вернуть два файла из B → `NEXUS-Host-Run`.

## H. Только владелец (Claude Code это не выполняет)
1. Удалить файл, не открывая: `Remove-Item -LiteralPath "$env:USERPROFILE\.nexus-host\owner-passphrase.txt"`.
2. Сменить пароль `/live` (файл лежал на диске открытым текстом): в PowerShell, пароль не отображается и не сохраняется:
   `$p = Read-Host 'Новый пароль /live' -AsSecureString; $t = [Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p)); $h = -join ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($t)) | % { $_.ToString('x2') }); Remove-Variable t, p`
   затем в папке шлюза: `$h | npx wrangler secret put OWNER_PASSPHRASE_SHA256` → `Remove-Variable h`. Новый пароль сохранить в Bitwarden. Действующие сессии `/live` закончатся сами (≤30 мин).

## Отчёт → `windows-pc-agent-lab/NEXUS-NEXT-0.6.1c-INSTALL-REPORT.md`
Шаг / факт / PASS-FAIL; PID Host и supervisor до/после каждого шага C.5; ParentProcessId supervisor'а (C.4); строки `tunnel.log` (без URL).
