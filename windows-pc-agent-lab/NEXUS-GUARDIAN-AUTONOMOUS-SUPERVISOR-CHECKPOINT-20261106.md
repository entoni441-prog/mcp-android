# NEXUS Guardian — autonomous crash observer and native epoch1 continuation

Date: 2026-11-06
Repository: entoni441-prog/mcp-android
Branch: experiment/nexus-guardian-autonomous-supervisor-20261106
Base: b99d6bda8f28a8cc2091bd133a3a840caf4be4f9

## Verified objective

An independent, test-only supervisor is started BEFORE any injected crash. It observes a real live native kernel Job, persists its own exclusive one-supervisor claim and emits ARMED only after native proof is present. When the previous native owner is SIGKILLed by the separate test harness, the supervisor itself waits for the OS named Job to disappear, validates exact session UUID and PREPARED operation with no external effect, burns one durable epoch1 budget attempt and starts a brand-new native epoch1 owner. That new owner assigns its child into a fresh kernel Job before resuming and the child resumes the ACTUAL existing authenticated Codex CLI in read-only mode with precisely the saved test UUID.

**No manual call to claimRecoveryAttempt or native epoch1 occurs after failure in this acceptance test.** The test harness only creates a new task, starts e0 and observer, and injects SIGKILL against its exact own e0 native process.

## Exact owner's Windows acceptance (2026-11-06)

```text
✔ automatic observer never consumes a budget for IN_FLIGHT and duplicate observers cannot overwrite owner
✔ owner STOP blocks autonomous launch before any epoch-1 claim
✔ after e0 owner SIGKILL, unattended observer launches exactly one native epoch-1 with same real Codex UUID
tests 3; pass 3; fail 0; skipped 0; exitCode 0
```

The real Codex positive test had the same saved thread UUID, completed the resumed turn inside the native epoch1 Win32 Job Object, confirmed a single budget claim and rejected duplicate owner attempts. No external user project action was performed.

## Independent CI

- GitHub Actions https://github.com/entoni441-prog/mcp-android/actions/runs/42231973098 — Windows negative tests 2/2 PASS, real Codex positive intentionally SKIP (no authenticated CLI on hosted CI), 0 failed. Linux parses experimental code without execution: SUCCESS.
- A prior CI failed because it compiled a test EXE under a name outside its existing native allowlist; the workflow name was corrected without relaxing the allowlist. Subsequent independent CI passed.

## Fail-closed and notification evidence

- Unverified live-old-Job observation: STOP (no late recovery based only on stale receipts).
- Another observer attempting the same task hits an immutable single-owner filesystem claim. It does not overwrite the real observer's result or its journal.
- Unknown IN_FLIGHT external effects always STOP without even burning an epoch1 budget attempt.
- An owner STOP marker always blocks recovery and claim.
- The supervisor checks the native binary SHA-256 before observing and again immediately before launch.
- A crash between burning the durable budget and native launch remains fail-closed: the attempt stays consumed and a new supervisor cannot silently retry.
- On explicit STOP the supervisor saves a sanitized, immutable local stop-notice-e0001.json. No cloud/provider delivery is attempted or claimed. On PASS there is no spurious STOP notice.
- Production `recover` still returns RECOVERY_NOT_ENABLED; only a test-only fixture and newly created temporary task roots are admitted.

## Environment untouched

No direct modifications to main, deployed NEXUS Host, Cloudflare Gateway, Windows Scheduler, security controls, Windows reboot, or owner power settings. No new Codex login, installation or subscription.
Before/after acceptance: NEXUS Idle, ownerBans power, the same five preexisting Codex-related PIDs 19276, 5820, 19388, 15792 and 9124, and zero test Guardian processes. Isolated Git worktree clean.

## Unfinished requirements for a deployable autonomous system

1. Test supervisor is not installed as a long-running service and does NOT survive its own death or a Windows reboot. Persistent supervision, boot logon and OS-owned restart arbitration remain unaccepted.
2. Test only has PREPARED/read-only deterministic local effects. Unknown IN_FLIGHT remains strict STOP. Real provider reconciliation/operation de-duplication is not implemented.
3. Phone/owner message transport for queued STOP notices is not connected. Never claim delivery from a local receipt.
4. Durable 30-minute OS-attested stable window and reset, testable owner pause, version-pinned deployment, and post-reboot acceptance remain future gates.
5. Scheduler registration, Windows reboot and production enablement require separate permission, and NEXUS power remains disabled.
