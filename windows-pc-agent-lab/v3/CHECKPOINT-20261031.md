# Windows PC Agent v3 — checkpoint 2026-10-31

- Experimental branch: `experiment/windows-pc-agent-v3-control-20261031` based on `87c381907f1584171ffb76736f5580255dbfe1f9`.
- Verified previous stage: existing v2 device identity and signed heartbeat worked in the isolated Cloudflare test environment.
- Prepared locally: an eleven-file v3 source prototype, including tests, readme, client, server, and schema. Archived SHA-256: `c50400186932d0d73a639f237b0a8018c0c97e648d121449d5fac5a0ac915c49`.
- Local Node 22 standalone tests (current session): five test cases PASS, Windows-specific DPAPI case SKIPPED on Linux, integration test NOT RUN to completion because the archive lacks the adjacent v1/v2 bundle expected by `build-worker.mjs`. Therefore do not call the complete v3 suite passed.
- GitHub repository state verified: branch contained README, checkpoint, `actions.mjs`, `identity-v3.mjs`; v3 server, Windows polling client, schema and full test sources remain absent due to earlier security block on code publication.
- New isolated workflow `.github/workflows/windows-pc-agent-v3-published-smoke.yml` was published at commit `d9bec3007db19fc8844bc869a9b57ba19c7ba0d8`. GitHub Actions run `41228555382` is SUCCESS on Windows and Ubuntu: syntax, import, fixed allowlist, traversal argument rejection, ECDSA synthetic signature. This is ONLY a test of already published modules, not integrated v3.
- No further attempt to bypass previous publication security rejection. Full Windows CI remains blocked until the remaining sources can be published through an authorized, permitted development workflow; do not deploy v3 before that.
- No real Windows v3 test performed.
- GitHub README was committed. Publication of the executable sources and SQL schema was blocked by a tool safety check. This is an explicit STOP, not a successful deployment.
- No v3 Worker deployed, no schema migration applied to D1, no v3 app installed or run on Windows. Do not claim a full remote-control capability.
- Do not change `main`, production, existing v2 Worker, or the Windows installation without further verified authorization and checks.

## Verified continuation — bounded v3 hardening
- Original source ZIP SHA-256 rechecked: `c50400186932d0d73a639f237b0a8018c0c97e648d121449d5fac5a0ac915c49`.
- Committed narrowly scoped fix to ALREADY-PUBLISHED `actions.mjs`: reject Windows reserved device names, handle asynchronous `spawn` failure. Commit `bfbfc6871e3abc32cbff952c51f52fbd541bdc3b`.
- Extended the already-published smoke workflow with synthetic regression cases for device names and failed GUI launch. Commit `a3112a116e8975a98d1ab6de948bf4159c848b34`, GitHub Actions run `41229031245`, **SUCCESS** on Ubuntu and Windows.
- Local independent protocol/file tests on hardened source: 7 PASS, 0 FAIL, one Windows-only DPAPI case SKIPPED in Linux. Isolated SQLite v3 migration + grant/queue/lease/result/replay/revocation behavior: PASS.
- Updated offline source archive (13 files including test + checkpoint): `windows-pc-agent-v3-hardened-20261031.zip`, SHA-256 `dca35042e93a2c4e9f18a1d3c761d61ef8238f4120f3a6bf87af6e0fafaea55a`. This is not a deployment.
- **Unresolved:** full v3 client/server/schema publication remains blocked by prior tool safety rejection; do not bypass. Combined v1+v2+v3 integrated Windows CI cannot be claimed until permitted publication and testing.
- No changes to main, production, active v2 Worker or user's Windows installation. No new v3 grant or job issued.

## Offline integration hardening — follow-up after 50860ad
- Inspected and verified earlier 13-file hardened archive: SHA-256 `dca35042e93a2c4e9f18a1d3c761d61ef8238f4120f3a6bf87af6e0fafaea55a`.
- Unpublished v3 Worker now has bounded **streaming** POST body reader (18 KB). Tests reject oversized Content-Length, chunked overflow, malformed JSON, invalid UTF-8 and invalid Content-Type before touching D1.
- Additional offline E2E test uses a synthetic ECDSA key and mock D1 for four queued operations: scoped create, read, optimistic-hash update, and traversal rejection; verifies eight audit events and signed claim/result receipts.
- Local Node.js 22 test summary: **12 passed, 0 failed, 1 skipped** (Windows-only DPAPI); v3 server and client syntax checks passed.
- Offline archive: `windows-pc-agent-v3-offline-integration-20261031.zip`, SHA-256 `b3783e3f20cc06dadbe4b20f24d3523e640c9f78bf0539e1fc48ce265d15be70`, verified ZIP integrity.
- **Not a complete Windows CI or live test.** No change to main, production, existing Cloudflare Worker/v2, active Windows installation; no new grant, remote task or deployment. Earlier block on publishing remaining executable v3 server/client/schema still applies, and was not bypassed.

## Runtime recovery checkpoint — following dc5e285
- Identified a concrete unattended-operation defect in the unpublished Windows client: `control-v3.lock` could remain after Ctrl+C or SIGKILL, preventing further launches until manually cleared.
- Prepared a minimal offline patch (not published as executable code) covering: `windows-agent-v3.mjs`, new `lock-v3.mjs`, and `tests/runtime-lock.test.mjs`.
- Patch: `windows-pc-agent-v3-runtime-fix-20261031.patch`, SHA-256 `fe2d0d3eb03112ebe229a2416b139d2900746e63a08763d95e50c359ccccd7f9`, 12,081 bytes. Applied it to a fresh copy of the previous offline source; `patch -p1 --dry-run`, actual patch application and syntax checks succeeded.
- New runtime behavior: graceful SIGINT/SIGTERM closes the lock and aborts pending HTTP/sleep; stale locks are recovered only if the recorded PID is no longer alive; malformed or active locks fail closed. No unrelated lock is deleted on release.
- New runtime tests: **6 PASS, 0 FAIL**, including actual child SIGINT/SIGKILL scenarios in Linux. Complete bounded offline suite (integration test requiring unpublished v1/v2 combined bundle excluded): **18 PASS, 0 FAIL, 1 SKIP** (Windows-only DPAPI). These results **do not** establish Windows-specific runtime correctness or a deployed v3.
- Limits: a recycled live PID conservatively blocks automatic recovery; user action could be necessary in that rare situation. In-flight synchronous file operations cannot be interrupted instantly. Neither a Windows background service nor GUI/desktop control is implemented.
- The earlier publication block on v3 server/client/schema remains. Do NOT use another connector or route to circumvent it. No v3 schema deployed, no commands issued to Windows, no changes to main, production, or the working v2.

## Verified Windows compatibility CI — after ecbb3e9
- Tested only previously permitted v3 components `actions.mjs` and `identity-v3.mjs` (no new remote-control executable publishing).
- New Windows integration tests: `windows-pc-agent-lab/v3/tests/windows-published-integration.test.mjs` at commit `eca25214b8d51d0aa11dc35ff7d392c9e2d3eaa0`.
- Updated GitHub Actions workflow at `b41b607b98249f032abc833d2a70b29367b7f203`. Run `41232681470`: **SUCCESS on Windows and Linux**. Windows job `124629956971` logs explicitly show 3 PASS cases: actual Windows DPAPI CurrentUser encrypt/decrypt and reuse of a synthetic v2 identity for v3 ECDSA signing; scoped file create/read/update/list; reserved device names and traversal rejection. No user secret, Cloudflare access or real device actions in CI.
- Live Cloudflare read-only preflight: existing `pc-agent-readonly-lab` Worker version `c7ff2d4f-0994-4462-b120-ef1116ba58a8` at 100%, D1 binding `8c972046-2add-4df7-9f16-a8172b8061e2` unchanged; `windows-v2` enrollment gate closed; 1 approved v2 device; 0 v3 tables. No schema migrations or deployments performed.
- **Hard release gate still BLOCKED:** executable v3 server, Windows polling client and SQL schema are absent from GitHub after prior safety rejection. Cannot claim full v1+v2+v3 Windows CI or perform safe staging deployment. No workaround of blocked publication attempted. Do not recreate missing modules from memory or stage incomplete code. Next permitted action requires an explicitly supported code-publication workflow, after which rerun full integration CI and review isolated deployment with rollback.
