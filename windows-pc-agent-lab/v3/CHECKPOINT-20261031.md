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
