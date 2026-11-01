# NEXUS 0.5.0 — единая живая приёмка (новый чат ChatGPT после Refresh tools)

Подготовка владельца: открыть свой Блокнот с вкладкой «owner-test» (ненужный текст). Не держать открытыми файлы с паролями.
Текст для ChatGPT (вставить целиком):

```
NEXUS 0.5.0, единая приёмка. По шагам, после каждого — сырой ответ инструмента. Ничего не додумывай; на consent_required спрашивай меня.
A. Диагностика: connection_status, host_diagnostics, get_capabilities. Ожидание: version 0.5.0, live_view=false, gui_input=false.
B. Live View: watch_nexus (без включения) → виджет показывает «выключен». Затем я скажу «включи Live View» → set_capability live_view=true → watch_nexus.
   Я проверяю: виджет в чате (inline / PiP / fullscreen) на ПК и на Android; курсор; кнопка Пауза.
C. Управление: set_capability gui_input=true → open_app notepad (покажи scratchFile и createdByNexus) → keyboard_action text "NEXUS 0.5.0 test" →
   ctrl+w на СВОЕЙ вкладке (ожидание: без согласия; «Не сохранять» разрешено) → перейди на мою вкладку «owner-test» → ctrl+w → consent_required → confirm_action cancel.
D. Приложения: manage_app_access request process=mspaint exe="C:\Windows\System32\mspaint.exe" → consent_required → я отвечу → confirm_action → open_app mspaint → закрой его (своё окно) → manage_app_access revoke mspaint.
E. Браузер: только если я сам включил browser в capabilities.json: browser_open https://example.com → browser_snapshot → browser_tabs new https://www.wikipedia.org → list → close.
F. STOP: я нажимаю ■ STOP в виджете → get_capabilities (ожидание live_view=false) → live_frame не вызывай.
G. Внешний Live View: я открываю https://nexus-gateway.entoni441.workers.dev/live на телефоне, вхожу паролем владельца (нужно снова включить live_view).
H. Финал: set_capability gui_input=false, set_capability live_view=false, read_audit_log 40. Итог: таблица шаг / ожидание / факт / PASS-FAIL.
```

Критерии PASS: шаг C — закрылась только NEXUS-вкладка, «owner-test» на месте; F — трансляция прекратилась на ПК (в окне Host строка «LIVE VIEW: off»);
во время B/G в окне Host видна строка «● LIVE VIEW: ON» и заголовок окна меняется; в audit нет кадров и введённого текста.
Если виджет не рендерится в каком-то клиенте — зафиксировать клиент/версию/что видно, Live View проверить через /live (G).
