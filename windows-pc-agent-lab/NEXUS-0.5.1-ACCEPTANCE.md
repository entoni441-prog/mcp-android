# NEXUS 0.5.1 — одна живая приёмка (новый чат ChatGPT после Refresh tools)
Владелец наблюдает; каждый пункт — факт из ответа инструмента/экрана, без «должно работать».

1. `get_capabilities` → grants по профилю, `session.active:false`.
2. GUI-задача: открыть Блокнот, набрать текст, открыть Калькулятор, посчитать 12*12, переключиться обратно. Live View включился до первого ввода; окон не больше двух; у Калькулятора `createdByNexus.windows` не пустой.
3. `focus_window` Блокнота → если `focused=false`, записать `cause`.
4. `finish_task` → `liveActive:false`, кадров нет, свои окна закрыты (scratch-вкладка без висящего диалога), вкладки владельца целы.
5. Сразу вторая GUI-задача → стартует без запроса разрешений (D4).
6. Посреди задачи нажать Stop в ChatGPT → время до остановки (audit: `client_cancelled` = сигнал дошёл; иначе `lease_expired` ≤ 45 с). Записать фактическую задержку.
7. Браузер (при `browser` в профиле): найти товар на известном сайте, добавить в корзину, перейти к оформлению — без вопросов; финальная кнопка заказа/оплаты → `consent_required` (what `browser_financial`) → ответить «отмена». Поле карты/пароля → `sensitive_field_refused`. После `finish_task` процессов Edge с профилем NEXUS = 0, Edge владельца цел.
8. Закрыть свою вкладку Блокнота по прямой просьбе → закрыта без повторного согласия; с несохранённым текстом → вопрос «Сохранить / Не сохранять / Отмена».

## Повторная проверка после hotfix 0.5.1-b (только непройденное)
A. Блокнот открыт владельцем с его вкладками → GUI-задача создаёт вкладку NEXUS → `finish_task`: в отчёте вкладка `closed`, method `tab_close_button` или `ctrl_w_verified`; окно и вкладки владельца на месте. Если `left` — записать `fallback` и `tabButtons`.
B. Demoblaze: Add to cart → результат с `dialogs:[{type:"alert",message:"Product added…"}]`, без `cdp_timeout`; Cart → Place Order → форма (имя/город) → Purchase → `consent_required` (`browser_financial`) → «отмена».
C. Stop в ChatGPT посреди GUI-задачи → audit `client_cancelled` или `lease_expired`, фактическая задержка.
