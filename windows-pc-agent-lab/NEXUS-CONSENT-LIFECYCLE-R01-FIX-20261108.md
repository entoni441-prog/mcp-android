# NEXUS Owner Consent visibility + R-01 false positive — verified checkpoint

Date: 2026-11-08 (Europe/Rome). Branch: `experiment/nexus-consent-visibility-remote-20261108`.
Base: `experiment/nexus-prelogin-reboot-access-20261108`.
**Status: source fix PASS in isolated experiment; active Host and Cloudflare Gateway NOT DEPLOYED/RESTARTED.**

## Owner incident, directly observed
- Chrome Remote Desktop Host MSI had successfully installed and signed by Google; user signed in to Google on the PC via normal Edge.
- Owner used the authenticated `/live/approvals` page. It later displayed **«Нет ожидающих запросов»**, while `host_diagnostics.pendingConsents` returned 1.
- The Agent had received `consent_required` for a browser click called **«Скачать Удаленный рабочий стол Chrome»**. Its label misleadingly said **«удаление/стирание данных»**.
- **Verified lifecycle root:** Host `consent.ownerDecide('allow')` only writes `p.ownerDecision='allow'`; the record remains in `pending` until a later `confirm_action` verifies target and performs the action. Gateway `approvalsPage` was filtering `data.pending.filter(x=>!x.decided)`, falsely presenting an empty page while the Host counted an approved-but-unconsumed record.
- At user's direction the Agent executed the **already owner-approved** exact request: `confirm_action` with id `103aac5acad2`, owner previously approved. Tool returned **`confirmed:true`, `decision:allow`**, mouse click done. Result: Edge navigated to the official Google Chrome Web Store Chrome Remote Desktop extension page; then `pendingConsents=0`. No consent was simulated, reused or bypassed.
- **Verified classifier root:** `policy.mjs` R-01 `DESTRUCT_STRONG_RE` substring `удал` matched adjective `Удаленный/Удалённый` in the app name, not a delete verb.

## Minimal changes on experiment branch
1. `nexus-host/policy.mjs`: `удал(?![её]нн)` replaces broad `удал` to distinguish remote-desktop noun/adjective; e.g. `Скачать Удаленный рабочий стол Chrome` becomes ordinary click. `Удалить удалённое устройство`, `Удаление удалённых подключений` still require owner approval.
2. `nexus-host/consent.mjs`: `pendingCount()` prunes expired records; document that approved-but-not-executed requests deliberately remain active.
3. `nexus-host/server.mjs`: additional disambiguating read-only counters `awaitingOwnerApprovals` and `approvedAwaitingExecution`.
4. `nexus-gateway/src/live-page.mjs`: both inline Live notice and separate `/live/approvals` show decided records distinctly. Approved requests say **«Разрешено владельцем; ожидается выполнение ChatGPT. Повторное подтверждение не требуется.»**. Page no longer auto-closes immediately after approval; empty-state means no active requests, not merely no unapproved entries. Does NOT expose secret, sign approvals, or alter cryptographic authorization.
5. Tests: `nexus-host/consent-sync-061.test.mjs` (new), `nexus-host/r01-052.test.mjs` and `nexus-gateway/test/owner-approvals-page.test.mjs`. Cover approved-awaiting-execution, cancel, TTL expiry, safe remote desktop, destructive delete still guarded and page scripting.

## Test results on actual Windows via isolated clone
- `node --test r01-052.test.mjs consent-sync-061.test.mjs server-042.test.mjs`: **13/13 PASS** (Host targeted).
- Gateway `node --test test/*.test.mjs`: **89/89 PASS**, including owner signatures, CSRF, widget, Live mobile v11, PIN/input protections.
- A separate broad Host run including `server-050.test.mjs` had **two known unrelated outdated-state failures**: test expects 43 catalog entries although live catalog has 45; a GUI test expects cursor (10,20) but observed actual owner cursor (895,467). Targeted Host code/change passed. These two were not modified or falsely reported as PASS.
- Checkout isolated under `C:\Users\krado\NEXUS-workspace\nexus-consent-sync-test-20261108`; only experimental GitHub branch changed.

## Safe release blocker
- **Active Windows Host source** is `C:\Users\krado\Documents\NEXUS\nexus-host`, active NEXUS Host online, Live v11 streaming.
- **Local installed gateway source** in `C:\Users\krado\Documents\NEXUS\nexus-gateway` is **older than the deployed Cloudflare script** (local `live-page.mjs` lacks `approvalsPage` while actual deployed Worker fetched from Cloudflare has it and URI `ui://nexus/live-view-v11.html`). NEVER deploy from local installed source or replace production Worker blindly: this would regress/break Live.
- Cloudflare Worker source read-only via existing Cloudflare connector confirmed deployed script contains the exact filter bug and Live v11. No Worker upload, settings change, credential access, NEXUS Host restart or production deployment occurred.
- A `wrangler deploy --dry-run` from the isolated checkout was **blocked by NEXUS policy as `security_command` R3**, even with `--dry-run`. The known request was **canceled**, not approved or executed. Do not bypass this owner approval by alternative execution path. Installation of isolated npm dependencies completed but did not alter the active gateway.
- **Before release:** preserve a verified worker rollback version, compare against actual deployed v11 bundle, obtain genuinely authorized R3 gate for deploy/build when needed; apply only this diff to current v11, regression/health tests, and verify owner and Host state counters. Prefer independent CRD remote access verified before touching production gateway/Host.

## Current owner-facing checkpoint
- Existing owner approval was consumed and Google extension download click executed successfully. Chrome Remote Desktop host binary and service exist but the remote device has **not yet been enrolled with owner PIN**, service still previously `Stopped/Manual`. CRD pre-logon access is NOT verified. No reboot and no unsaved Notepad changes.
- No more owner action is needed for the **previous** download click. The two defects are fixed and tested in an experimental branch, **NOT yet active in production**. Do not ask owner to find an already-consumed button.
- Defer production rollout rather than risk losing the only working remote-control gateway. Continue CRD setup and confirm independent logon, then safely release the protected update.
