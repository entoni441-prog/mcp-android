# ACTIVATE — NX-13 hotfix for installed NEXUS 0.6.1d

**STATUS: PREPARED / INSTALLATION NOT AUTHORIZED.** Этот документ — инструкция для будущего отдельного разрешения владельца, не команда на установку.

## Immutable source and scope

- **Source SHA:** `4cfc3603660fcfc70b3ccb5fca973af0b742d802` на ветке `experiment/nexus-0.6.1d-20261105`.
- **Previous installed source SHA:** `ba9689d4eee5c2a9d83e67475dd405eabdf39119`.
- **CI:** [42100299119](https://github.com/entoni441-prog/mcp-android/actions/runs/42100299119) — **Windows, Linux, Gateway 3/3 PASS** на исходном SHA. Перед фактической установкой повторно сверить, что URL/коммит не изменились.
- **Manifest:** `MANIFEST-NX13-HOTFIX-0.6.1d.sha256`.
- **Replace ONLY three runtime files:** `nexus-host/consent.mjs`, `nexus-host/uia-script.mjs`, `nexus-host/gui.mjs`.
- **Do NOT replace:** `windows.mjs`, `apps.mjs`, `procs.mjs`, `discover.mjs`, supervisor, scheduled tasks, Gateway, owner security, `power`, `main`.

## Hard preflight (STOP on mismatch)

1. Получить отдельное явное разрешение владельца на установку именно hotfix и данный source SHA.
2. Подтвердить NEXUS Host online (0.6.1d), корректные PID/командные строки Host и supervisor, существующую задачу `NEXUS-Host-Run`, отсутствие `host-off` / owner-stop.
3. Подтвердить, что установленная версия **всех трёх заменяемых файлов** имеет ожидаемые SHA-256:
   - `consent.mjs`: `bba0a77c36f5cb5fe10c060bf60cac3b56df3300d3d4c40903a1dba8d3117fda`
   - `uia-script.mjs`: `f46cff2be45ec5c5bf789ddac2e5bef3cdd21f0daa0f57953971f7c8ff874ff4`
   - `gui.mjs`: `6997d240827b2e75e512fb05adcc46c5f0c420713d8e8c141dd41aee1857fa75`
   Несовпадение означает изменившуюся базу — **STOP**, не переписывать поверх неизвестного кода.
4. Проверить исходные файлы по hotfix-манифесту на закреплённом коммите. После любых документационных коммитов не использовать подвижный HEAD как источник.

## Installation and rollback (only after approval)

1. Создать новый timestamped backup **трёх** исходных runtime-файлов, проверить SHA-256, размеры и доступность каждого; сохранить путь и хэши в журнал.
2. Запустить отдельный автономный установщик/план с журналом состояний, поскольку NEXUS перестанет отвечать при остановке собственного Host.
3. Остановить **только** подтверждённые PID supervisor и Host без `/t` (не трогать другие дочерние процессы или окна владельца).
4. Атомарно заменить ровно три файла, проверить SHA-256 по манифесту, запустить существующую задачу `NEXUS-Host-Run` — не создавать новую и не запускать параллельный Host.
5. Проверить новые PID **Host и supervisor**, механизм самовосстановления supervisor, локальный health, Cloudflare Gateway/MCP online и повторный SHA-256 3/3. Если не подтверждены — **автоматический откат** на три backup-файла с повторной проверкой SHA и supervisor/health.

## Targeted real acceptance

- **NX-13 positive:** Edge в отдельном NEXUS-профиле, открыта настоящая французская страница. `mouse_action(click)` на `ImageButton/Закрыть` native translation bubble закрывает **только панель**, не запрашивая согласия на закрытие всего Edge. Проверить, что основное окно и вкладка остаются живыми; в журнале оба HWND и `edge_translate_win32_owner_verified`.
- **NX-13 negative:** безопасно диагностировать UIA/Win32 и gate для настоящей кнопки закрытия всего Edge, чужого popup/другого PID/ошибки Win32; **не нажимать** реальную кнопку закрытия чужого окна. Gate должен быть `consent_required`.
- Только NX-13, успешные NX-19 и NX-21 повторно не тестировать без объективной причины. При функциональном FAIL оставить результат FAIL и оценить откат по риску; при опасной регрессии owner consent — немедленно откатить.

**Checkpoint:** до отдельного разрешения текущий рабочий Host остаётся на прежнем коде `ba9689d4`; никакой установки не совершать.
