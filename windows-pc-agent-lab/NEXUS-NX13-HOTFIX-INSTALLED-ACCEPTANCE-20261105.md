# NEXUS 0.6.1d — NX-13 hotfix: установка и реальная приёмка

**Дата:** 05.11.2026; запуск 20:19 UTC (21:19 Europe/Rome).
**Статус: INSTALL PASS / REAL NX-13 E2E PASS / ROLLBACK NOT NEEDED.**

## Источник, разрешение и охват

- Владелец явно разрешил установку NX-13 hotfix в текущем диалоге: «Выполняй разрешение, даю».
- **Immutable code SHA:** `4cfc3603660fcfc70b3ccb5fca973af0b742d802`. Документы и манифест: `f6e8f37`.
- CI [42100299119](https://github.com/entoni441-prog/mcp-android/actions/runs/42100299119): Windows/Linux/Gateway — **3/3 success**.
- Использована `ACTIVATE-NX13-HOTFIX-0.6.1d.md`; заменены **ровно три runtime-файла:** `consent.mjs`, `uia-script.mjs`, `gui.mjs`.
- `apps.mjs`, `windows.mjs`, `procs.mjs`, `discover.mjs` (NX-03), Gateway, `main`, `power`, настройки безопасности и задачи Планировщика **не менялись**.

## Бэкап и установка

- Новый бэкап до остановки процессов: `C:\Users\krado\Documents\NEXUS\_backup-nx13-hotfix-pre-20261105T201747Z` — три старых runtime-файла, **SHA-256 и размеры 3/3 PASS**.
- Автономный установщик: `C:\Users\krado\Documents\NEXUS\_activate-nx13-hotfix-20261105.mjs`.
- Журнал выполнения: `C:\Users\krado\Documents\NEXUS\_activate-nx13-hotfix-20261105-state.json`, финальная фаза `installed_verified`.
- До обновления Host PID `21788`, supervisor PID `10212`. Остановлены только проверенные PID, без `/t`.
- После запуска через существующую задачу `NEXUS-Host-Run`: Host PID **`21640`**, supervisor PID **`19208`**, локальный health PASS, Gateway **HTTP 200**.
- SHA-256 установленных файлов после перезапуска, включая независимую повторную проверку:

| Файл | SHA-256 | Итог |
|---|---|---|
| `consent.mjs` | `dcd772d4d34b4c69652d08f05daeb7da0d8ab3b0f0817243a5cf435d4f027ac3` | PASS |
| `uia-script.mjs` | `31dd2378e9daee2eb16638692d3feb59e4ad54b7301fd8cc25ccc2628c4bab15` | PASS |
| `gui.mjs` | `25aa8f4743c41ae16929137f4292a6c77bf4b8b58d1a32e223fbe44d056aeed3` | PASS |

## Реальная приёмка NX-13 — PASS

1. Через NEXUS `browser_open` открыт **отдельный Edge-профиль NEXUS** на французской Wikipedia; главное окно Edge PID `5176`.
2. Через `inspect_ui` отдельно определены две кнопки `Закрыть`: основная `EdgeWindowsCaptionButton/view_7` и **панели перевода** `ImageButton` (координаты экрана `x=784,y=110`).
3. Обновлённый рабочий Host выполнил `mouse_action({action:'click',x:784,y:110})`: **`done:true`**; consent не запрошен.
4. Повторный `inspect_ui` подтвердил отсутствие `ImageButton/Закрыть` в панели перевода; `list_windows` и screenshot подтвердили, что основное окно Edge PID `5176` и вкладка Wikipedia **остались открыты**, а переводческая панель исчезла.
5. Audit записал: `event=native_popup_dismissed`, `reason=edge_translate_win32_owner_verified`, popup HWND `1444314`, main/owner HWND `264402`, PID `5176`.
6. Основную кнопку закрытия окна Edge **не нажимали**: отрицательные сценарии проверены заранее модульными тестами и mutation sensitivity. Никаких чужих окон не закрыто.

## Состояние и границы

- Host 0.6.1d + NX-13 hotfix: **Online**, tunnel HTTP 200, 3/3 runtime SHA PASS.
- Бэкап сохранён для возможного отката; установка не потребовала отката.
- Ранее подтверждённый NX-19 PASS не повторялся; NX-21 остаётся **защита PASS / полный сценарий Steam владельца BLOCKED** до адресной проверки.
- Успешные тесты NX-13/19/21 и утверждённая сборка не означают, что NX-03/26 прошли приёмку: они отдельные задачи.
- Следующее действие: сохранить этот документ как docs-only checkpoint. Не менять рабочую версию без нового задания.
