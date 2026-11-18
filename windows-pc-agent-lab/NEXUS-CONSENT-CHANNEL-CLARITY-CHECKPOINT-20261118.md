# NEXUS — why /live showed no requests while Host counted 1

Date: 2026-11-18 (Europe/Rome).
Isolated branch: `experiment/nexus-consent-channel-clarity-20261118`.
Scope: diagnosis + read-only visibility improvement. **Not deployed to running Host, Gateway or production/main.**

## Reproduced sequence
- Owner explicitly permitted replaying a read-only SSH/Termux `curl` status query to Shelly after attempting to join Samsung guest Wi-Fi.
- NEXUS returned `consent_required` with `what: arbitrary_command`, `kind: grant`, 120-second TTL and an `alreadyDone` warning because the same external command was journaled earlier.
- Live page displayed `Нет ожидающих запросов`. Host diagnostics earlier showed `pendingConsents: 1` but `awaitingOwnerApprovals: 0`.
- On expiry, `pendingConsents` also became zero. This was not a missing transport delivery: records existed only in the **chat** consent tier, which is deliberately excluded from the signed owner page.

## Source-level root cause
`nexus-host/consent.mjs`:
1. `requestGrant` computes `ownerTier = autonomy && OWNER_WHATS.has(what)`.
2. `arbitrary_command` is not in `OWNER_WHATS`. A repeat of an external operation still enters `pending` because `prev` exists, but has `owner:false`, unlike privileged owner-only operations.
3. `ownerList()` filters `pending` to `p.owner`, so `/live` correctly shows no owner approvals.
4. `diagnostics().pendingConsents` previously counted **all** pending requests and therefore could be misread as the number waiting on /live.
5. Changing a repeat into a privileged owner request would change the security policy; **this staging fix does not do that**. The earlier platform restriction on invoking `confirm_action` is separate and remains unresolved; do not bypass it by varying commands.

## Staging change
- `nexus-host/server.mjs`: add `pendingChatConsents` to read-only `host_diagnostics` as total live pending minus owner-tier pending. Preserve existing `pendingConsents`, `awaitingOwnerApprovals`, `approvedAwaitingExecution` semantics.
- `nexus-host/consent-channel-visibility-20261118.test.mjs`: verify exact replay condition (total=1, chat=1, owner=0, no execution), 120-second expiry, and the opposite owner-tier case (total=1, chat=0, owner=1).
- No changes to consent granting, signed owner authentication, expiry, credentials, router, Shelly, relay, production Gateway, NEXUS Host runtime or main branch.

## Guarded editing
- `files_scoped read` redacted protected spans of `server.mjs`; a full-file rewrite was immediately rolled back using Git, then original SHA-256 `b2298e939a9fd8dc8f0ddcdbc2907925adba314e3b51bccea1c402451d443478` was verified.
- Applied a 3-line surgical unified diff through `git apply --check` and `git apply`; `git diff --check` PASS. Diff contains only the new diagnostic field and its comment, no modified secrets.

## Verification
- `node --test consent-channel-visibility-20261118.test.mjs consent-sync-061.test.mjs owner-061.test.mjs`: **19/19 PASS**, exit 0.
- Additional legacy `server.test.mjs`, `server-050.test.mjs`, `e2e-gateway.test.mjs`: 17 pass, 4 fail, 1 skip, exit 1. Four failures are outdated assertions unrelated to diagnostics: expected catalog 43/44 vs actual 45 (2 failures), Live View pointer coords mismatch (1), terminal minimize error text mismatch (1). Do **not** describe full regression suite as PASS or casually alter those tests.
- No real remote SSH replay was run during this fix and Shelly guest reachability remains UNVERIFIED.

## Next gate
A separate review may decide whether to redesign approval UX to communicate chat-only requests to the owner, while preserving the owner-only signed decision channel. Requires tests and explicit scoped authorization before deployment. This staging patch is purely diagnostic and can be reviewed/rolled back independently.
