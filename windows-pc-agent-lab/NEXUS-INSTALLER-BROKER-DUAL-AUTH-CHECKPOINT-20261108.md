# NEXUS Installer Broker — checkpoint разработки

**Дата:** 08.11.2026, ~14:56 Europe/Rome.
**Ветка:** `experiment/nexus-installer-broker-dual-auth-20261108`
**Основа:** `experiment/nexus-prelogin-reboot-access-20261108`.
**Статус:** **экспериментальный код + автоматические тесты PASS; привилегированный Broker НЕ зарегистрирован, реальные установки НЕ выполнялись**.

## Запрос владельца
Две независимые формы разрешения обычной установки:
A. Владелец разрешает в переписке ChatGPT; NEXUS устанавливает проверенную программу с минимумом дальнейших действий, без дублирующего подтверждения в Live.
B. Владелец разрешает точное действие в NEXUS Live; то же действие проходит независимо от чата.

Оба варианта → единый ограниченный исполнитель, проверка подписи/целостности, повторное исполнение запрещено, сохранение STOP, без передачи PIN/паролей модели. Первый вход Windows/UAC нельзя заменять фальшивой кнопкой: реальное OS-admin provisioning требуется один раз.

## Реализованные файлы в новом каталоге `windows-pc-agent-lab/nexus-installer-broker/`
- `contract.mjs`: Ed25519 proof для независимых trust roots `chat` и `live`, строгая структура сообщения, срок 5 минут, подпись всех полей, allowlist Google CRD MSI, версия и SHA-256 зафиксированы.
- `broker.mjs`: проверяет подпись и права, SHA/bytes/Google publisher, защищённое staging-перекопирование и повторную проверку, единственную фиксированную команду `C:\Windows\System32\msiexec.exe /i <protected-google-msi> /qn /norestart`, журнал и проверку сервиса; при неизвестном исходе не повторяет операцию.
- `journal.mjs`: одноразовый durable claim с atomic `wx`, состояния `executing` / `installed_verified` / `outcome_unknown`, работа только в заранее защищённой папке.
- `windows-package.mjs`: на реальном Windows читает точный путь Google MSI, SHA-256, размер и валидную Authenticode Google LLC, без установки.
- `windows-io.mjs`: Windows adapter с фиксированным MSI, staging и сервисной проверкой. Не вызывается автоматически.
- `acl-check.mjs`: fail closed при незащищённых владельце/правах каталогов Program Files/ProgramData и всех импортируемых модулей, а не только точки входа.
- `task-xml.mjs`: фиксированная on-demand Scheduled Task `NEXUS-Installer-Broker`, `HighestAvailable`, `InteractiveToken`, `IgnoreNew`, только защищённый `run-once.mjs`. **Не регистрирует** задачу.
- `run-once.mjs`: fail-closed если запускается из девелоперской копии, без admin token, валидных ACL, двух заранее установленных публичных ключей и подписанной операции.
- `submitter.mjs`: общий непривилегированный вход для подписанных A и B: пишет одноразовый envelope в строго фиксированный inbox и вызывает только `schtasks /Run /TN NEXUS-Installer-Broker`; не имеет полномочий запуска произвольных команд.
- Unit/Windows tests: `broker.test.mjs`, `platform.test.mjs`, `runner.test.mjs`, `submitter.test.mjs`.

## Фактические проверки
- На реальном Windows в независимой рабочей копии `C:\Users\krado\NEXUS-workspace\nexus-installer-broker-dev-20261108`: **26/26 Node тестов PASS**, exitCode 0.
- Отдельно прочитан реальный подписанный MSI `C:\Users\krado\NEXUS-workspace\downloads\chromeremotedesktophost.msi`: **Authenticode Google LLC Valid**, файл 24 616 960 байт, SHA-256 `1aef26d305b0091bba71589d3caaabe6db5a042648e5801969332086db7c1a90`. Не загружался повторно.
- В тестах подтверждены независимые A и B, подделка/переключение канала, истечение срока, replay, STOP до исполнения, отсутствие privilege boundary, неожиданный исход, подмена пути/команды/MSI, durable journal и static task-XML.
- `git diff --check FETCH_HEAD HEAD` против базовой ветки PASS. Ветка содержит **13 новых файлов / 811 добавленных строк** до этого документа.
- NEXUS Host/Gateway healthy, tunnel HTTP 200; Chrome Remote Desktop service **не установлен**. Никаких изменений Windows безопасности / UAC / service / startup / main / Gateway / Host. Windows не перезагружалась и незаписанный Notepad не менялся.

## Критические недостающие части — НЕ объявлять production готовым
1. **Требуется первое OS-elevated provisioning через настоящий Windows UAC.** Windows MSI Error 1925 доказал недостаток medium token. Перенос кода в защищённое Program Files, создание ACL, public-only trust store и регистрация HighestAvailable task *не выполнены*. Это нельзя оформить модельным согласием как системный токен.
2. **Действующие chat/Live signed authorization endpoints ещё не подключены.** Тесты используют две временные тестовые пары ключей. Live уже имеет собственную owner-passphrase + Ed25519 подпись на Gateway, но отдельная signing flow для установки ещё не создана. Для «разрешения в чате» нужен проверяемый owner-source/аттестация платформы либо узкая заранее подписанная владельцем одноразовая политика: обычный текст через LLM не считается криптографической подписью. Нельзя автоматически mint signed chat grant из текста web/email/tool или из model-generated params.
3. Нужен отдельный authenticated dedicated Host tool для запроса конкретного pinned install, без общего elevated shell, и изолированный Gateway Live endpoint с nonce, CSRF/owner-session.
4. Требуется security review до привилегированной установки: ОС-backed ACL и trust root provisioning, path race/reparse point, signer identity, replay/durable ledger, STOP при активном MSI, точная проверка installed product, логирование без секретов. Не запускать elevated code до review.
5. Не протестировано: фактическая Elevated Task, реальная установка CRD, Google owner enrollment/PIN, Remote Login до Windows signin, controlled reboot, независимое power-on.

## Безопасный следующий маршрут
1. Одно адресное security review Claude на перечисленный diff (без переработки работающего Host).
2. После review — подготовить и проверить настоящий owner-elevated one-time provisioner с rollback, подписанными файловыми SHA и защищёнными ACL. **Первое подтверждение Windows UAC требует владельца у физического ПК или уже доверенного admin-capable канала**. Не отключать UAC, не использовать SYSTEM обходом, не менять main.
3. Подключить отдельно два канала подписания: verified chat/ограниченная предавторизация и authenticated owner Live. Прогнать независимые E2E A и B на ограниченном тестовом пакете.
4. Проверенная установка CRD, owner-only Google authorization и PIN через доверенное UI; проверить телефонный доступ до логина; затем сохранение Notepad и реальная перезагрузка с автоматическим возвратом NEXUS.
5. Полное выключение и дистанционное включение — отдельный этап, сейчас `wakeDevice=null`, Ethernet отключён.

**Итог:** двухканальный ограниченный исполнитель разработан и tested, **но OS onboarding и реальные каналы владелец→подписанный grant не активированы**. Не просить пользователя заново одобрять уже разрешённую экспериментальную разработку; спросить только при реальной потребности OS-UAC или рисковом production изменении.
