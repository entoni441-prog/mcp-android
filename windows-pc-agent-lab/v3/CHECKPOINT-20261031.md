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

## Full-integration release gate — 2026-10-31 (after a4b55ff)
- GitHub branch verified before change: `a4b55ffe9e31bceff5effcbe31f740461feaa125`. Published under `.github/workflows/windows-pc-agent-v3-full-integration.yml` an isolated release gate and Windows/Linux full-integration CI definition. Commit `4ca43c31cd0f2448859c4c08ab5b70073eaee615`.
- GitHub Actions run `41233092285` executed the release gate; **failure is expected and intentional** because 10 required v3 source/test files are missing. Full-integration job is **SKIPPED** due to this gate failure. This is NOT a failed test of the v3 agent and certainly not a successful full test.
- Missing core published files include `worker-v3.mjs`, `windows-agent-v3.mjs`, `schema-v3.sql`, `build-worker.mjs`, and `lock-v3.mjs`, plus protocol/runtime integration test files. Already published `actions.mjs` and `identity-v3.mjs` remain intact and had independent Windows DPAPI and workspace test SUCCESS in run `41232681470`.
- **STOP remains:** prior tool safety checks explicitly blocked publishing full v3 executable components. The release gate does not circumvent that restriction. No alternate connector or publishing mechanism was used for blocked sources. No v3 deployment, D1 migration, device grant or remote commands.
- Next permissible unblock: publication of the missing sources only through a workflow that affirmatively permits the upload; then this committed GitHub Actions workflow runs full offline Windows/Linux integration automatically. Until then, do not claim readiness, do not change production, v2, main or Windows installation.

## Independent security and integration audit — 2026-10-31
- Read-only verified source review saved as `windows-pc-agent-lab/v3/AUDIT-20261031-INDEPENDENT.md`, commit `7f471acc2d43a01915d629b72531769f1be8fd0f`.
- Reviewed published v3 `actions.mjs` + `identity-v3.mjs`, their synthetic Windows CI tests, actual v2 DPAPI key format and signed POST protocol, release gate, Cloudflare live readback, and full file-backed Antigravity consultation.
- Release remains **BLOCKED**: no published v3 worker/client/schema/full tests. Other audit findings: plaintext result retention in D1, filesystem reparse/TOCTOU and multiwriter CAS limitations, `open_app` relative executable search, potentially overridable reserved signing fields, synthetic-test vs live-device coverage gap, stale v2 README status.
- Independent consultant's proposal mostly restates existing v3 pull architecture. Its sample GET+Bearer interface is not the verified v2 ECDSA POST contract; claims about bypassing safety filters via names are unsupported/rejected.
- No execution, v3 deployment, data writes to D1, user Windows actions, production/main modifications, paid resources or workaround of tool restriction.

## Verified published-module security fixes — 2026-10-31
- Changes in experimental branch ONLY:
  - `d72d9c3`: `identity-v3.mjs` now rejects signed-request reserved-field overrides, null and array input.
  - `77683d0`: `actions.mjs` resolves allowlisted Notepad/Calculator through absolute Windows `SystemRoot\\System32` paths, not PATH search.
  - `af46cb6`, `c2a01ac`: negative tests for signature overrides, Windows app absolute path, and symlink/junction workspace escape.
  - `903fe36`: GitHub Actions synthetic `SystemRoot` used for cross-platform launcher-failure test.
- Last checked published-module CI: **GitHub Actions run `41240093359`, SUCCESS on both Ubuntu and Windows**. Windows: **6 PASS, 0 FAIL, 0 SKIP**. Verified Windows job logs. The initial intermediate commits had failing CI and were superseded by fixes; do not report those as final.
- Follow-up audit record: `windows-pc-agent-lab/v3/AUDIT-20261031-INDEPENDENT.md`, updated in commit `30ba8d9`.
- Remaining concerns explicitly unresolved: filesystem TOCTOU/reparse races and multiactor SHA conflict; private file contents in Cloudflare D1; missing executable worker, Windows poller, SQL schema and full integration tests. Full v3 CI is still **BLOCKED intentionally**, not PASS.
- No v3 deployment, access grant, real Windows task, Cloudflare D1 mutation, production/main/working v2 changes, paid resources or restriction bypass.

- Follow-up historical documentation clarification: v2 README corrected in commit `0056786d7c1dd1ad169cf92133a55c630e5f5342`; audit updated at `641a4edd1d2b58518a896f9060fd1e09eb14d31b`. No v2 code or deployment changed.

## Supported local Windows access route decision — 2026-10-31
- Independent official documentation check identified **ChatGPT Work Local + Computer Use + Remote connections** as the supported direct ChatGPT-to-Windows route, subject to the desktop app, actual account eligibility, host connection, approvals and Windows unlocked foreground session.
- Exact design/acceptance gate: `windows-pc-agent-lab/v3/SUPPORTED-LOCAL-WINDOWS-ROUTE-20261031.md` (commit `93b046af3c94a389547bf0dd7f0ae5513c531178`).
- **Not yet verified:** user Windows PC is connected to ChatGPT Work Local; Computer Use available and approved; mobile remote continuation works. This session lacks a connected local Windows host tool, so these steps require approved local desktop-app access.
- Alternative Antigravity Remote Control only accesses whichever computer hosts Antigravity CLI: tested Linux Codespace is not the local Windows host. Do not present it as Windows desktop control.
- Existing v3 publication STOP unchanged; no new worker/client/schema publishing, no test D1 mutation, no production/main/working v2 modification and no paid resources.

## Regular ChatGPT → own Windows 11 UI channel, without Astra Work quota — 2026-10-31
- User explicitly rejected Work as the operational execution route because it uses a separate limited quota. Ordinary chat and current Cloudflare Entoni MCP are the intended control interface.
- Public technical research: OpenAI Computer Use uses connected host + secure relay + per-app permissions and foreground Windows; Windows UI Automation and consent-based Windows.Graphics.Capture are suitable public OS-level building blocks. OpenAI proprietary Work implementation was NOT retrieved or copied.
- Architecture decision `windows-pc-agent-lab/v3/CHAT-DIRECT-WINDOWS-DESIGN-20261031.md`, commit `ed3802285dfbeb0af558187dcf259dada67a5f72`; prior Work-first route explicitly superseded in commit `e82c7c90f7a32d37f269a13e8629fa1058a25cfc`.
- Live D1 read-only inspection: v2 device remains approved, last heartbeat `1793468912` (2026-10-31 17:48:32 UTC), last sequence 5. This verifies previous telemetry, NOT an active Windows GUI control process. Existing v2 client supports only outgoing heartbeat, no command polling.
- **Critical missing component:** approved local Windows UI executor, running under logged-in user with explicit app-level consent, plus supported deployment and review. Full executable v3 worker/client/schema remains blocked from publication, no alternate connector, encoding or backdoor.
- No new Windows enrollment, Cloudflare D1 write, third-party spend, Work use, production/main/v2 modification, or Windows-side installation. Current state: DESIGN READY / CLOUD READ PASS / LOCAL UI UNAVAILABLE / RELEASE STOP.
