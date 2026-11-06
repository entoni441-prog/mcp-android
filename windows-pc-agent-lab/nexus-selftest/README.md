# NEXUS self-test (некоммерческий)

Из корня репозитория, без установки пакетов:

```powershell
node --test windows-pc-agent-lab/nexus-selftest/selftest.test.mjs
```

Требуется Node.js 18+ (проверено на Node.js 24). Модуль экспортирует
`evaluateNexusSnapshot(snapshot)`: чистую синхронную функцию без файлового,
сетевого или процессного I/O. Она не вызывает NEXUS и не меняет политики.

## Контракт

Вход — обычный JSON-совместимый объект с уже распакованными данными трёх
ответов (`structuredContent`, без MCP/JSON-RPC обёрток):

```json
{
  "connection_status": {
    "gateway": "ok",
    "tunnelProbe": {"status": 200},
    "verdict": "online"
  },
  "host_diagnostics": {
    "hostPid": 123,
    "tunnel": {"cloudflaredAlive": true},
    "pendingConsents": 0,
    "capabilitiesFileError": null
  },
  "get_capabilities": {
    "grants": {"power": false, "ownerBans": ["power"], "fileError": null}
  }
}
```

`tunnelProbe.status` — HTTP-статус пробы Host через туннель, возвращаемый
Gateway; транспортный HTTP-статус самого вызова Gateway этим контрактом не
передаётся. `gateway` должен быть строго `"ok"`. PID — положительное безопасное
целое; число подтверждений — неотрицательное безопасное целое. Булевы поля
проверяются строго, без преобразования строк. `ownerBans` — массив строк.
Оба поля ошибок конфигурации обязательны и должны быть строго `null`.

Выход: `{overall: 'PASS'|'WARN'|'FAIL', checks: [{id,status,reason}]}`.
Фиксированные ID: `gateway_http`, `connection_verdict`, `host_pid`,
`tunnel_alive`, `power_ban`, `pending_consents`, `configuration`.
Все причины — фиксированные строки; входные значения не копируются.
Лишние поля, включая синтетические token/password, игнорируются.

`online_with_recent_reconnects` даёт WARN; `online` — PASS по вердикту.
Timeout, offline и прочие/неизвестные вердикты дают FAIL.
Положительное число ожидающих подтверждений даёт WARN. Пропущенные или
некорректные обязательные поля и конфигурационные ошибки дают FAIL.
Итоговый приоритет: FAIL > WARN > PASS.

Проверяется только переданный снимок, без подтверждения его свежести или
подлинности. Отсутствие дополнительных полей не влияет на результат.
Не передавайте объекты с исполняемыми getters/Proxy: контракт рассчитан
на данные JSON. Реальные токены, настройки и переписки для тестов не нужны.
