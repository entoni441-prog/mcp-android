# NEXUS Live v10 — захват заголовка окна и корректное сворачивание

Дата: 8 ноября 2026, Европа/Рим. Статус: **CODE PASS / РЕАЛЬНАЯ ПРИЁМКА Samsung И HOST НЕ ПРОВЕДЕНА**.
Базовая ветка: `experiment/nexus-live-v9-pinch-zoom-20261108`.
Рабочая ветка: `experiment/nexus-window-titlebar-gesture-20261108`.
До получения явного разрешения **не устанавливать Host, не публиковать Gateway, не менять main и настройки защиты**.

## 1. Подтверждено пользователем на реальном Samsung
- Live v9: pinch zoom 1–5× и перемещение увеличенной **картинки** работают. Скриншоты 11:06 Italy показывают масштаб 3.8×, разрешение кадра 1280×720.
- Не работает **перемещение реального окна Windows** из карточки Live.
- Попытки касания кнопки «Свернуть» в заголовке WindowsTerminal выдавали `owner_handoff_active`, окно не сворачивалось.
- Не путать drag изображения с drag реального окна; второе — новая задача.

## 2. Установленная точная причина повторяющегося owner_handoff_active
Read-only Host audit:
- 10:05:08.293Z `mouse_action click x=1165,y=177` перешёл в `handoff_requested`, ID `h-216b603e9e`, reason `shell_command`. Был распознан ввод в защищённый WindowsTerminal, а не отдельное управление кнопкой заголовка.
- Все последующие `mouse_action` из Live в 10:05–10:10 возвращали `owner_handoff_active` уже **из-за удерживаемого sticky handoff**. Их результаты **не подтверждают** попадания в конкретную кнопку/неисправность mapping.
- Ранее независимый инструмент `minimize_window({pid:444,title:'NEXUS Host',ownerRequested:true})` вернул verified true без shellInputSent — штатное безопасное сворачивание уже реализовано.
- Одноразовый read-only UIA probe в нынешнем состоянии Windows по историческим координатам попал в Explorer desktop, не в Host. Это не доказательство состояния кнопок во время Samsung теста. Ветка очищена от этого ненужного одноразового probe test.
- **Нельзя автоматически сбросить handoff**: `live_control resume` допустим только после новой явной команды владельца «Продолжай». Не использовать прежний ID/PID как постоянные.

## 3. Изменения в экспериментальной ветке v10

### Gateway / Live (widget.mjs)
- После **удержания пальца на заголовке ~500 мс без движения** запускается режим «Захват окна», после чего движение пальца до отпускания формирует **ровно один** `mouse_action drag` из начальной и конечной координаты Windows.
- Быстрые движения пальцем продолжают панорамировать увеличенное изображение; два пальца по-прежнему масштабируют и отменяют ожидаемый drag, и не отправляют удалённый клик.
- Координаты начала/конца отображаются через трансформированный `img.getBoundingClientRect` на исходный desktop; ошибочные/устаревшие кадры отклоняются.
- Во время захвата изображение само не перемещается. Реальное окно Windows перемещается **после отпускания пальца**, с подтверждением Host; не выдавать это за непрерывный потоковый drag.
- Новый URI `ui://nexus/live-view-v10.html`, версия appInfo `10.0.0-titlebar-gesture`; старые v9/v8/v7 ресурсы сохранены в Gateway. Каталоги Host/Gateway остаются byte-identical.

### Host (gui.mjs, policy.mjs, uia-script.mjs)
- `mouse_action drag` при доказанном `nativeCaptionDrag` идет через `uia(mode:'move_caption')`, а не через Java Robot / терминальные клавиши. C# Win32 перед перемещением повторно проверяет точный живой PID+HWND и `WM_NCHITTEST == HTCAPTION(2)`; `SetWindowPos` меняет только геометрию top-level window, проверяет итог. Не работает на secure desktop, maximized, невалидной точке/заголовке и не переносит окно полностью за экран.
- Неверифицированное касание в верхней полосе **WindowsTerminal** отклоняется с `terminal_caption_unverified` **без нового sticky owner handoff**. Никакой ввод в shell не разрешён.
- `isTitlebarMinimizeTouch`: у строго распознанного UIA Button «Minimize» / «Свернуть» допускается `isPassword` отсутствующее (но не `true`); прежняя слишком строгая проверка `=== false` могла скрывать легитимную кнопку. Native Win32 proof остается.
- Новая длина фиксированного UIA PowerShell скрипта превысила per-env variable лимит Windows. Runner передаёт скрипт через две env-переменные по 23000 символов, собирает их в коротком `-EncodedCommand` bootstrap и удаляет env перед выполнением. Код не записывается на диск, request JSON по-прежнему отдельным env; автотест проверяет точную конкатенацию. Это изменение затрагивает общий UIA runner и требует особого внимания перед установкой.
- Нет изменений в owner security policy (DENY_APPS, секреты, UAC, OTP), только отдельно доказанные visual-window operations.

## 4. Фактические проверки
- Host regression: **90/90 PASS** (policy, owner-touch-pref, session, owner-061, GUI, titlebar gesture, natural touch, universal minimize, terminal contract). Windows реальная компиляция C# и PowerShell AST прошли. Изолированный набор по GUI — **41/41 PASS**.
- Gateway regression: **82/82 PASS** (включая статические, geometry, zoom/pan runtime и long-hold drag runtime).
- В дополнительном старом тесте `server-050.test.mjs` обнаружены **два устаревших ожидания** (43 инструмента против текущих 45; старое значение курсора). Это не результат нового изменения — файл не редактировался; в общие показатели PASS не включать. Legacy `terminal-minimize-contract.test.mjs` актуализирован под уже действующий universal minimize и новый native move, при повторе PASS.
- Никакие действия по реальному перемещению окна Windows на production Host в этом цикле не выполнялись.
- **Не подтверждено:** реальный drag и minimize WindowsTerminal через Live на Samsung после установки v10.

## 5. Чеклист безопасной установки/приёмки
1. Перед изменением production: перечитать актуальный commit и статус NEXUS, убедиться в работоспособном Recovery Guardian, резервной копии Host и установленной версии v9 Worker. Проверить CI/тесты, защиту main.
2. Для C# P/Invoke и нового общего UIA bootstrap желательно точечное независимое ревью Claude по diff (без полноценной разработки), особенно защита HTCAPTION, PID/HWND, запрет секретов и fallback при ошибке. Claude — ревьюер, **ChatGPT — основной исполнитель**.
3. Только с новым разрешением владельца: установить Host через ранее проверенный OS-owned safe activation с checksum+backup+verify и возможностью отката. Не повторять незавершённые Live v4 installs.
4. После подтверждения Host — опубликовать Gateway v10 из этой ветки, проверить /health и OAuth, открыть **новую** Live-карточку v10, не старую закешированную v9.
5. Если Host по-прежнему держит `owner_handoff_active`, отдельно получить от владельца явное «Продолжай» перед `live_control resume`. Не сбрасывать автоматически.
6. E2E Samsung: pinch zoom, быстрый pan, затем **удержать палец 0.5 с на пустой части заголовка окна и протянуть**, отпустить. Сверить `mouse_action -> window_move verified:true shellInputSent:false`; подтвердить изменение геометрии. Проверить, что long press по терминальному тексту запрещён.
7. Короткий тап именно по «−» должен вернуть `action:'minimize',verified:true` без `owner_handoff_active`. Если UIA/Win32 не может доказать Minimize, вернуть `terminal_caption_unverified`, сохранить hit-test diagnostics и остановиться — не ослаблять shell-политику.
8. Обязательный rollback: прежний Host из существующей резервной копии, Gateway — предыдущий Cloudflare Worker deployment, а не старый URI шаблона.

## 6. Источники
- Branch: https://github.com/entoni441-prog/mcp-android/tree/experiment/nexus-window-titlebar-gesture-20261108
- Parent v9: https://github.com/entoni441-prog/mcp-android/tree/experiment/nexus-live-v9-pinch-zoom-20261108
- Общий handoff для Claude: https://github.com/entoni441-prog/mcp-android/blob/experiment/nexus-natural-touch-20261108/windows-pc-agent-lab/NEXUS-CLAUDE-HANDOFF-20261108.md

**Состояние:** исправление готово как исходники и автоматические тесты, **не принято на Samsung и не установлено**.
