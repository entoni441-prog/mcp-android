# Независимый аудит Windows PC Agent v3 — 31.10.2026

## Область и достоверность
Проверены опубликованные файлы `v3/actions.mjs`, `v3/identity-v3.mjs`, `v3/tests/windows-published-integration.test.mjs`; источник формирования ключа `v2/windows-agent-v2.mjs`, серверный протокол `v2/worker-v2.mjs`; файлы `v3/README.md`, `v3/CHECKPOINT-20261031.md`, GitHub Actions runs `41232681470` и `41233092285`, отдельный ответ Antigravity в `bridge/reports/ANTIGRAVITY-WINDOWS-V3-CONSULTATION-20261031.md` из ветки `experiment/agy-codespaces-autostart-20261030`. Проводился **статический аудит исходников и чтение результатов CI**, не полноценное повторное выполнение тестов и не live-аудит локальной Windows.

Дополнительная read-only проверка Cloudflare: Worker `pc-agent-readonly-lab` на версии `c7ff2d4f-0994-4462-b120-ef1116ba58a8` обслуживает 100% трафика; D1 `8c972046-2add-4df7-9f16-a8172b8061e2`: 1 одобренное устройство v2, enrollment gate закрыт (`expires_at=0`), таблиц `v3_%` нет.

## Вывод
**v3 НЕ готов к публикации или развёртыванию.** Сильная сторона: существующий v2 и прошедший CI механизм DPAPI P-256 действительно дают пригодную основу для идентификации устройства, шести ограниченных действий и проверки подписей. Однако отсутствуют опубликованные v3 сервер, polling-клиент, SQL и необходимые end-to-end тесты. Невозможно подтвердить действительную модель удалённой авторизации, отзывов доступа, очередей и журналирования. Ранее зафиксированная инструментальная блокировка публикации исполняемых компонентов остаётся действующей; её обход недопустим.

## Приоритизированные выводы

| Приоритет | Наблюдение | Доказательство / последствие | Корректное действие |
|---|---|---|---|
| P0 — release STOP | В ветке отсутствуют `worker-v3.mjs`, `windows-agent-v3.mjs`, `schema-v3.sql`, `build-worker.mjs`, `lock-v3.mjs` и несколько тестов. | GitHub `v3/` directory и полный gate run `41233092285`: ожидаемое `failure`, интеграция `skipped`. | Не развёртывать. Проводить обзор лишь разрешённых опубликованных модулей; недостающие компоненты — только после явно разрешённой публикации и проверки. |
| P1 — security design | Серверная валидация полномочий и срока grant, replay/nonce, аренды задач и подтверждения результата НЕ поддаётся проверке по GitHub. | Серверный исполняемый файл отсутствует. Локальный README/чекпоинт не заменяет исходники. | Требовать полного согласованного интерфейса и негативных тестов перед release gate. Не заявлять, что схема защищена в runtime. |
| P1 — confidentiality | `read_text` возвращает содержимое файла из рабочего каталога; согласно дизайну результат предполагается хранить в D1 открытым JSON. | `actions.mjs` возвращает `text`; `v3/README.md` прямо предупреждает о plaintext в D1. | Запретить секреты/персональные данные в рабочем каталоге; перед боевым применением выбрать изоляцию доступа, TTL/удаление результатов и при необходимости end-to-end шифрование. |
| P2 — filesystem | Проверки `existsSync`/`lstatSync`/`realpathSync` до `readFileSync`, `mkdirSync` или `renameSync` не обеспечивают атомарную защиту от изменения reparse point/symlink между проверкой и использованием. | `actions.mjs` `targetPath()` и `write_text`. | При расширении доступа: защищённые файловые handle-based операции, политика Windows junction/reparse и негативные тесты; не выдавать текущую проверку путей за race-proof sandbox. |
| P2 — file update | Проверка `expectedSha256` и `renameSync` разделены, нет межпроцессного lock/CAS. | `actions.mjs` `write_text` после `textFile(full)`; комментарий автора также признаёт отсутствие транзакционности. | На первом этапе только одиночный исполнитель в отдельном каталоге; для многопроцессной записи — отдельная блокировка/транзакционная стратегия и тесты конфликтов. |
| P2 — command resolution | `open_app` запускает `notepad.exe`/`calc.exe` по имени, то есть зависит от штатного поиска исполняемого файла в среде Windows. | `actions.mjs`: `launcher(exe,[],...)`. | Использовать проверенный абсолютный системный путь и закреплённый набор бинарников; тестировать отказ при подмене PATH/cwd. |
| P2 — signing API | `signedV3(route, identity, extra)` применяет `...extra` после `id/timestamp/nonce`, то есть внешние поля могут затенить базовые. Эксплуатация не доказана, потому что вызывающий код не опубликован. | `identity-v3.mjs`: создание `payload`. | Явно запретить зарезервированные имена в `extra` и покрыть отрицательными тестами; не принимать произвольные поля с сервера для подписи без белого списка. |
| P2 — live/coverage | Windows CI подтвердил три проверки на синтетическом ключе и временном workspace, но не в связке с реальным одобренным Windows-устройством, Worker v3 или D1. | Run `41232681470` SUCCESS; run `41233092285` BLOCKED. | Сохранять различие между module tests, offline full integration и live opt-in испытанием. |
| P3 — documentation | v2 README всё ещё начинается со статуса «NOT DEPLOYED», хотя его поздние пункты, журнал и Cloudflare readback подтверждают live v2. | `v2/README.md` и состояние Cloudflare. | Привести README в соответствие с датированным, отдельно подтверждённым статусом, без повторного развёртывания. |

## Сверка с независимым советом Antigravity
1. **Подтверждено:** Cloud Linux Codespaces не является локальной Windows. Нужен отдельно авторизованный локальный исполнитель.
2. **Не является новым решением:** outbound polling → Cloudflare/D1 → ограниченный whitelist уже составляет основу проекта v3. Повторное написание того же механизма не устраняет блокировку.
3. **Несовместимое без переработки предложение:** Antigravity привёл `GET /api/v3/tasks/poll` с Bearer token, тогда как реальный v2 контракт подписывает ECDSA POST-запросы; `identity-v3.mjs` также подписывает `POST`. Этот фрагмент — только пример, а не проверенный drop-in путь.
4. **Неподтверждённое предположение:** неизвестно, какие именно сигнатуры/правила стали причиной прежнего отказа инструмента. Заявления об обходе фильтров путём смены терминологии не обоснованы и НЕ являются допустимой рекомендацией.
5. **Методическая ошибка запроса:** Antigravity был дан один CLI-промпт с уже предложенной архитектурой и требованием назвать **один минимальный маршрут**, а не независимая многораундовая экспертиза альтернатив. Он не проверял опубликованный код, что ограничивает ценность ответа.

## Конкретный следующий маршрут без дублирования разработки
1. **STOP** на исполняемых v3 компонентах и любых live grant/job/миграциях до разрешённой публикации и полного ревью.
2. Исправлять безопасно лишь опубликованные и разрешённые области: негативные unit-tests для `signedV3` и файловых операций, проверка пути исполняемого файла `open_app`; отдельно разработать приватность результатов D1. Изменения кода — после проверки тестового покрытия, только экспериментальная ветка.
3. Для действительно независимой консультации просить Antigravity: сначала 2–3 альтернативные архитектуры **без подсказки готового решения**, затем аудит конкретного published code, затем контраргументы и ограничения. Не тратить дополнительные TinyFish кредиты на GUI-loop при отсутствии нового проверяемого пути вывода.
4. На любой будущий релиз: полный source gate → Windows+Linux offline integration PASS → isolated staging rollback plan → локальное явное согласие на запуск Windows агента → ограниченная real-device проверка и отзыв доступа.

### Запреты
Не маскировать функциональность ради обхода фильтров, не разрабатывать скрытый shell/RAT, не менять `main`/production/v2/рабочие Windows, не тратить деньги на новый Codespace/подписку/пополнение без разрешения. Этот файл — аудит, не разрешение на release.

## Verified regression repairs — 31.10.2026 (after initial audit)

**Scope:** existing published v3 identity/action modules and their tests, on the same experimental branch only. No executable v3 server, Windows polling client, D1 migration or deployment.

- **P2 signing override:** fixed in `identity-v3.mjs` at commit `d72d9c310df281e2c05f260562775afc19064b06`. `signedV3` rejects caller-supplied `id`, `timestamp`, `nonce`, `signature`, prototype-related property names, null and arrays. A negative regression test verifies that a normal `seq` request remains correctly signed.
- **P2 PATH executable resolution:** fixed in `actions.mjs` at `77683d07c1b975e74420ac56f3fa3c11e09bfedc`. `open_app` now uses an absolute `SystemRoot\\System32\\notepad.exe` or `calc.exe` path and rejects absent, relative and UNC system roots; no command or task argument can select another executable. Does not attest to the authenticity of a compromised process environment.
- **Filesystem escape regression coverage:** tests now exercise path escapes through a symlink/junction, attempts to write through it, existing reserved Windows names and parent traversal. These tests verify the existing link-check behavior; they do **not** prove resistance to a malicious concurrent rename/reparse-point race. Handle-based confinement and multiwriter optimistic-CAS limitations **remain open**.
- **CI configuration** updated to pass a synthetic absolute Windows root when testing launcher error behavior on non-Windows runners.
- **Independent CI result:** GitHub Actions `41240093359` — Ubuntu SUCCESS and Windows SUCCESS. Windows logs: 6 tests, **6 PASS / 0 FAIL / 0 SKIP** (including real synthetic DPAPI CurrentUser round-trip and above regressions). This does not validate live Windows v3 server/device integration.

**Still open:** P0 full-v3 source gate blocked by prior publication restriction; P1 plaintext file-result retention in D1 and lack of auditable server-side grant/nonce logic; P2 concurrent filesystem race and CAS; live end-to-end opt-in test; stale historical v2 README. No workarounds of the denied executable publication and no rollout performed.

**Controlled next milestone:** prioritize confidentiality/retention policy for v3 results and review the missing server/client sources **only through an expressly permitted source-publication/review workflow**. Do not launch Cloudflare v3 tasks or grant access while release gate remains blocked.

- **P3 documentation partial closure:** v2 README header was corrected in commit `0056786d7c1dd1ad169cf92133a55c630e5f5342` to distinguish historical pre-deployment instructions from the later verified, read-only live v2. The original historical checklist remains for provenance and must not be treated as new deployment instructions.
