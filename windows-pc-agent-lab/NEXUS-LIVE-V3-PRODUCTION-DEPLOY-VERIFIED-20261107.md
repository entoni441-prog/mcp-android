# NEXUS Live v3 — production deployment verified

Date: 2026-11-07 (Europe/Rome)
Source branch: `experiment/nexus-live-interactive-20261107`
Code commit: `4d8af3f1fa01543acc50dda35b5ad48827b9a402`
User-feedback changes: compact owner and boot panels, protected owner fallback `/live`, STOP always on top.
GitHub Actions: `42355564855` PASS both Windows and Ubuntu; local CI 53/53 passed.
Deployment authorized by owner through NEXUS Live external /live: consentId `8cc6c39aa453`, decision allow, confirmed by Host.
Approved command plan id: `f9b1242368e268c5db5801b3d606dc4dc0851bc382ede202b2b46d3327558c9b`.
Both plan steps finished with exitCode 0: (1) Wrangler deploy --dry-run --outdir dist; (2) Wrangler deploy.
Production Cloudflare Worker: `nexus-gateway`.
New deployment id: `6000af2a-1e8f-4275-a0dd-64d6262071a5`.
**New version**: `7c0a8cb1-cb4d-4aea-850f-79305e900d5a` receiving **100% traffic**.
**Rollback version**: `8e3735e6-eb73-4e42-9710-f0ea63214b8c` (previous deployment id `b4166de7-f419-4fd7-ab0d-3026988e718b`).
Post-deploy:
- `GET /health` HTTP 200.
- `POST /mcp` without OAuth HTTP 401.
- NEXUS Windows Host `0.6.1-next` online, no recent tunnel reconnects.
- Pending owner consents: 0.
- `watch_nexus` live state active and frames enabled.
- Current ChatGPT conversation's tool UI annotation still says "View only" from old cached plugin metadata. Actual **Android Live v3 visual acceptance is not yet confirmed**, and the client must Refresh the NEXUS plugin and start a new chat before testing v3 control and collapsible panels.
- No Host executable update or Windows settings change was made. No `main` mutation.
- Owner approvals from embedded Android widget had earlier shown `Failed to fetch`; live v3 includes link to authenticated `/live` fallback. Must evaluate Android iframe origin/CSP after refresh and never assume a fetch failure equals approval.
- Touch input must remain explicitly opt-in and must not be used for passwords, PIN, OTP, tokens, financial details or Windows Secure Desktop. Windows pre-logon control not implemented.

**Next user task:** Refresh ChatGPT plugin NEXUS - Windows PC and open a new chat, run watch_nexus, verify mobile v3 compact default and owner confirmation popup. Test safe clicking/text only on a non-sensitive app. STOP and rollback checks when necessary.
