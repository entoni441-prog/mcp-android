# NEXUS Live v3 — mobile acceptance blocker and pre-deployment checkpoint

Date: 2026-11-07 Europe/Rome
Branch: `experiment/nexus-live-interactive-20261107`
Code commit: `4d8af3f1fa01543acc50dda35b5ad48827b9a402`
Status: **PREPARED / CI PASS / NOT YET DEPLOYED**

## Actual Android report
Owner opened current v2 Live within ChatGPT Android and observed:
- Host screen visible; HOST_ONLINE.
- Owner approvals panel expanded and taking excessive vertical space.
- Pressing verify requests returned `Подтверждение не выполнено: Failed to fetch`.
Owner said he had approved the release, but the Host did not receive a valid signed owner approval. The 10-minute consent `06ce369e7d2f` expired; `confirm_action` returned `consent_expired_or_unknown`. Do not falsely report it as approved or execute it.

## Diagnosis
- Production Gateway remains `8e3735e6-eb73-4e42-9710-f0ea63214b8c` (100%), known rollback target.
- Host `0.6.1-next` online, tunnel available, no recent connection errors.
- HTTPS `OPTIONS /live/widget/challenge` from a sample web-sandbox Origin returned HTTP 204 with expected CORS headers.
- HTTPS POST with deliberately invalid argument returned HTTP 400 JSON `invalid_operation` with proper CORS headers.
- HTTP GET `/live` returned 200. The trusted external page exists and is the supported fallback for owner authentication.
- Therefore service/CORS baseline is healthy; exact reason Android iframe `fetch` fails is still unverified (possible client sandbox/CSP). Never treat a browser `Failed to fetch` as an accepted owner decision.

## Changes after owner feedback
- Both status panels compact by default; boot details are an accordion, owner confirmation form is collapsed initially.
- Owner confirmation overlay auto-hides when pending approvals vanish or after a signed decision.
- On embedded network failure it displays a non-secretive error and an external `/live` fallback link; no automatic approval occurs.
- The STOP bar is z-index 110 vs overlay 100, so STOP remains clickable at all times.
- Existing explicit opt-in touch input and owner passphrase separation retained.

## Verified
- On Windows NEXUS isolated workspace: **53/53 tests pass** (Node 24).
- GitHub Actions run `42355564855`, Windows and Ubuntu PASS, including Wrangler `deploy --dry-run` and catalog parity.
- Wrangler `whoami` verified the owner-signed session with workers-write permissions (no token disclosed).
- No Windows security policy changes; PowerShell .ps1 execution remains prohibited. NPM invoked through official node npm CLI, avoiding policy change.
- Isolated workspace `C:\\Users\\krado\\NEXUS-workspace\\nexus-live-interactive-deploy-20261107` checked out from this branch.
- No production deployment, no installed Host change, no main changes.

## Release gate
1. NEXUS command_plan for `node.exe node_modules\\wrangler\\bin\\wrangler.js deploy --dry-run --outdir dist` then `node.exe node_modules\\wrangler\\bin\\wrangler.js deploy` in isolated gateway directory.
2. Policy classifies Wrangler deployment as owner-tier `security_command`; obtain a fresh one-time owner signature via authenticated `https://nexus-gateway.entoni441.workers.dev/live`. ChatGPT mobile widget is currently unreliable for authorization.
3. Call NEXUS `confirm_action` with exact consent and target, then `command_plan.run` with returned valid plan ID.
4. Verify deployment id/version, `/health` and `/mcp` unauthorized 401, Host online, resource list v3 first, STOP semantics. If broken, rollback 100% to `8e3735e6-eb73-4e42-9710-f0ea63214b8c` using Cloudflare Worker Deployments API.
5. Only after real Gateway deployment can owner Refresh the NEXUS plugin and open a new ChatGPT chat for v3 mobile acceptance.
