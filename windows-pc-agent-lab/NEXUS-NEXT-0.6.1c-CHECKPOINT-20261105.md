# CHECKPOINT — NEXUS NEXT 0.6.1c / 05.11.2026

**Основа:** installation checkpoint `a426dbef304fa3f5ec2c5f08b41937851a42861a`.  
**Новая приёмка:** `windows-pc-agent-lab/NEXUS-NEXT-0.6.1c-ACCEPTANCE-20261105.md`, report commit `422f69110b08ffe781c026bec883847152e1180e`.  
**Branch:** `experiment/nexus-0.5.2-owner-access-20261102`. **main/production не изменять.**

## Последний проверенный статус
- Host **0.6.1c installed** (version string `0.6.1-next` expected), PID **7528**. Supervisor self-healing C.5.1/C.5.2 **PASS** по установочному отчёту, **не повторяли**.
- NEXUS 42 exposed tools; `get_status/get_capabilities/host_diagnostics` PASS. Connection gateway/tunnel **online**, probe HTTP 200, zero reconnects in 15 min.
- `power:false` and `ownerBans:["power"]` intact. No production/security changes.
- Session/live stopped at end: `active:false`, `liveActive:false`, `taskStatus:finished`.

## Незакрытые тесты для следующей сборки
| ID | Статус | Блокер |
|---|---|---|
| NX-052-03 | FAIL | `open_app chatgpt` -> `app_not_found` при существующем окне |
| NX-052-13 | FAIL | Edge Translate bubble Close -> consent на закрытие всего окна |
| NX-052-19 | PARTIAL / FAIL enumerator | Explorer CabinetWClass не попадает в `list_windows`; окно успешно NEXUS-owned и закрывается |
| NX-052-21 | FAIL | Steam launch PID 2460 / steamwebhelper window PID 18656, потеря provenance; Grok PWA не фокусируется |
| NX-052-26 | FAIL focus / PASS UIA | `msinfo32` UI tree читается, `focus_window` -> `foreground_lock_likely` |

**Дополнительное:** read-only PowerShell `Format-List` ложноположительно классифицирован как `boot_or_disk_destruction`. Три owner-consent запроса оставлены без подтверждения (TTL). Закрытие Steam login window после теста не подтверждено: процесс не распознан как NEXUS-owned, автоматическое закрытие потребовало согласия. После `finish_task` не выполнялось повторного GUI-осмотра.

## Передавать Claude
1. Взять из полного отчёта точные параметры вызовов, PID, trace, фактические/ожидаемые состояния.
2. Диагностировать и исправить только FAIL-участки, не переделывать работающие функции.
3. Создать regression tests и следующую сборку **только в экспериментальной ветке**.
4. Повторить на реальном Windows лишь подтверждённые FAIL; ZIP extraction, download, C.5 и другие PASS не повторять.
5. Не вызывать `power`, не менять безопасность, production или рабочие настройки без отдельного распоряжения владельца.
