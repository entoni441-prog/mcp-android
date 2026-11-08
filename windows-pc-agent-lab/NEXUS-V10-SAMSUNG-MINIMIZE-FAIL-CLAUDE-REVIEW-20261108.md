# Claude review request — NEXUS Live v10: minimize fails after terminal handoff

**Дата:** 08.11.2026, 11:54 Europe/Rome (скриншот владельца), диагностика ~10:55 UTC.
**Запрос:** независимое архитектурное ревью и минимальное исправление. Claude — ревьюер с правом вмешательства; ChatGPT — основной исполнитель. Экономить лимит Claude: не переисследовать всю платформу.
**Текущий статус:** P0 для пользовательской приёмки: **FAIL** прямого сворачивания `WindowsTerminal / NEXUS Host` касанием внутри Live. Zoom/pan изображения PASS на реальном Samsung. Drag **реального окна** не получил подтверждённого PASS. **Рабочие Host/Gateway не изменять без нового отдельного согласования.**

## 1. Что владелец видит (факт)

На последнем снимке в текущем чате ChatGPT Android:
- NEXUS Live v10 в карточке внутри чата; `Управление: вкл.`, zoom `2.1×`, `1280×720`.
- Внутри увеличенного кадра окно `NEXUS Host` с обычными кнопками `−` / `□` / `×`. Пользователь неоднократно нажимает `−`, но окно остаётся открытым.
- Виджет пишет `Действие не выполнено: Error code: INVALID_ARGUMENT; Err...`; у нижнего края присутствует `Подтверждения` и `Открыть отдельно`.
- Пользователь подтвердил, что pinch-zoom и панорамирование изображения работают, но сворачивание — нет. **Успех публикации/автотестов не считать успехом UX**.

Скриншот пользователя приложен непосредственно к сообщению ChatGPT от 08.11.2026 ~11:54 Italy, **не находится в GitHub**. Ключевые видимые детали перенесены текстом выше.

## 2. Ключевые сведения из Host audit (прочитано read-only после жалобы)

Фактическая последовательность (время UTC):

| Время | Действие | Результат |
|---|---|---|
| 10:53:28.823 | `mouse_action click (864,419)` | `stale_args: task_resumed`, запрос повторной идентификации цели |
| 10:53:32.440 | `mouse_action click (864,419)` | `handoff_requested`, reason `shell_command`, handoff ID `h-ed2c76b294` |
| 10:53:37.771 | `click (1064,44)` | `owner_handoff_active` |
| 10:53:42.321 | `click (1056,43)` | `owner_handoff_active` |
| 10:53:48.639 | `click (1073,43)` | `owner_handoff_active` |
| 10:53:49.985 | `click (1175,46)` | `owner_handoff_active` |
| 10:54:23–36 | `click (1061,43),(1070,61),(1068,48),(1059,53),(1062,50)` | Все `owner_handoff_active` |

**Вывод с высокой уверенностью:** первый фактически обработанный клик `(864,419)` активировал защиту терминала как потенциальный ввод команды. После этого касания заголовка (около y=43–61) блокировались **ранее активным sticky handoff**; по этим отказам нельзя заключить, что геометрия/Win32/UIA кнопки «−» неработоспособна. Эти координаты могут быть правильными, но Host не дошёл до нативного caption proof.

**Неизвестно:** почему именно возник click `(864,419)`: ошибочная координатная трансформация при увеличении, отдельный реальный тап по содержимому терминала, stale frame или обработчик повторного клика после `stale_args`. Не утверждать конкретную причину без инструментального доказательства. Порядок и значения audit достаточны для поиска.

После жалобы read-only `host_diagnostics`: `hostPid=23324`, Host `0.6.1-next`, `ownerAction:{handoffId:'h-ed2c76b294',reason:'shell_command'}`, `pendingConsents=5`, tunnel healthy. `list_windows` подтверждает открытое `WindowsTerminal` PID **444**, title `NEXUS Host`. `live_control(status)`: трансляция active. Не выполнять `live_control resume` без нового явного разрешения владельца, не переводить старый handoff в подтверждение выполнения какой-либо команды.

`pendingConsents=5` включает запросы от предыдущих повторных `curl`-проверок, которые создал ChatGPT, а **не доказанные запросы на сворачивание**. Не одобрять их автоматически; UI может показывать ссылку «Открыть отдельно» из-за этих заявок.

## 3. Что уже установлено и подтверждено (НЕ делать повторно)

- Репозиторий `entoni441-prog/mcp-android`.
- Активная экспериментальная ветка `experiment/nexus-titlebar-v10-os-owned-activation-20261108`.
- v10 Host установлен через независимую одноразовую OS-owned Scheduled Task, фаза `installed_verified`, SHA-256 трёх файлов совпали, backup существует `C:\Users\krado\Documents\NEXUS\_backup-titlebar-v10-pre-20261108`. Host online после восстановления. Это не виртуальная симуляция.
- Cloudflare Gateway v10 Worker version **`38a2f14b-724d-4686-8e90-c17b2dfa978e`**, проверено напрямую через Cloudflare deployment API: **100% трафика**.
- MCP widget URI `ui://nexus/live-view-v10.html`, отличается от v9 для инвалидации кеша.
- Gateway tests 82/82 PASS (авто), selected Host tests 90/90 PASS (авто), controller tests 7/7 PASS; реальная приёмка прямого сворачивания FAIL.
- Независимый инструмент `minimize_window({pid:444,title:'NEXUS Host',ownerRequested:true})` **раньше** возвращал `verified:true`, `shellInputSent:false` и реально свернул окно. Это доказывает, что Windows умеет сворачивать этот terminal безопасным путём, но НЕ доказывает, что обычное касание попадёт в тот же путь.
- `main`, production security settings, парольные политики не тронуты.
- Подробные предыдущие чекпоинты:
  - [v10 установка и деплой](NEXUS-V10-HOST-INSTALLED-GATEWAY-PENDING-20261108.md) (файл с историческим названием PENDING, но внутри есть финальное UPDATE о публикации).
  - [v10 исходные решения / тесты](https://github.com/entoni441-prog/mcp-android/blob/experiment/nexus-window-titlebar-gesture-20261108/windows-pc-agent-lab/NEXUS-LIVE-V10-WINDOW-TITLEBAR-CHECKPOINT-20261108.md).
  - [базовый NEXUS handoff](https://github.com/entoni441-prog/mcp-android/blob/experiment/nexus-natural-touch-20261108/windows-pc-agent-lab/NEXUS-CLAUDE-HANDOFF-20261108.md).

## 4. Точные code entry points для ревью Claude

1. `windows-pc-agent-lab/nexus-host/gui.mjs`, `mouse_action()` примерно **738–828**, особенно **760–808**: есть ранняя ветка `isTitlebarMinimizeTouch` / `nativeCaptionMinimize` → `uia({mode:'minimize'})`; новая `nativeCaptionDrag` → `move_caption`; fallback для WindowsTerminal `terminal_caption_unverified`; далее `policy(... mode:'input')`, что инициирует `shell_command` handoff.
2. `nexus-host/policy.mjs`, `isTitlebarMinimizeTouch` около **468–479**: проверка типа кнопки, имени, geometry, PID/HWND. Безопасная кнопка не должна требовать shell handoff.
3. `nexus-host/uia-script.mjs`: `NxCaptionMinimizeAt` и `NxCaptionDragAt` / `NxCaption.Proof` и Win32 `WM_NCHITTEST`.
4. `nexus-gateway/src/widget.mjs`: pointerdown/move/up примерно **800–905**; Zoom CSS `img.getBoundingClientRect`, `framePointToScreen`, explicit double tap / delayed single tap, `callOnceAfterStale`. Принципиально отличить реальное касание содержимого терминала от ложного click после zoom/retry.
5. Источник sticky `owner_handoff_active` — Host task/session/handoff guard, проверять порядок блокировок. Не снимать все запреты ради одной визуальной кнопки.

## 5. Что просим у Claude (независимый конкретный вывод)

**Нужен только один адресный review** прежде чем тратить лимит на реализацию:

- Восстановить по коду фактическую последовательность `click (864,419) → stale_args → shell handoff → блокировка caption clicks`. Отделить доказанное от недоказанного. Указать root cause или минимальный дополнительный **read-only** trace, которого не хватает.
- Дать безопасный минимальный patch plan: как гарантированно обрабатывать **доказанные действия с визуальным заголовком** без передачи в shell, не нарушая защиты содержимого Terminal. Проверить, что после случайного тапа по terminal content владелец может сворачивать окно через строго проверенное оконное действие без снятия защиты terminal input (либо обосновать альтернативу с отдельным безопасным route).
- Оценить, есть ли ошибочное преобразование координат в zoom 2.1×, повторный click после `stale_args`, ненужные sticky handoffs, или window coordinate mismatch. Не угадывать, если нет proof.
- Указать **точный маленький набор тестов**: positive minimize/drag с проверенным native proof; negative terminal content, UAC, Close, unknown titlebar; stale / zoom; отсутствие повторов shell input. Успех — только реальный `minimize verified:true` из нового Live на Samsung.
- **Не выполнять** restart/rollback/deploy, не менять main и безопасность. Дать короткий вывод + предложенный diff или scope. ChatGPT затем реализует и проверит. Claude вмешивается в разработку только если без него не удаётся снять конкретный blocker.

## 6. Acceptance / STOP
- Обычное касание `−` в live увеличенном изображении сворачивает NEXUS Host в панель задач с `verified:true`, `shellInputSent:false`; не требует Owner passphrase.
- Удержание на **пустой полосе заголовка** + перенос двигает реальное окно Windows, без команд в terminal, не только картинку.
- Любые касания **внутри содержимого terminal** или неопределённые titlebar hit-test остаются запрещены без отправки команд. Не допускается бесконечный owner_handoff_active от ошибочного касания при дальнейших безопасных действиях.
- После изменения: Host тесты + Gateway тесты и **один реальный Samsung E2E**, без повторения уже PASS zoom.
- Если независимая оценка не даёт безопасного пути, остановиться, назвать точный blocker и не менять production.

**Итог на момент handoff:** проверенная инфраструктура жива, масштабирование работает; проблема — безопасный маршрут от сенсорного нажатия к window minimize через Host/session guard, а не отсутствие функции сворачивания в Windows. Решение пока не принято.
