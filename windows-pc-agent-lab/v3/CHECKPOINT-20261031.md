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
