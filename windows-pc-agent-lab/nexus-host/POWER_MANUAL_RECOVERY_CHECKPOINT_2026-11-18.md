# NEXUS power manual recovery — checkpoint 2026-11-18
## Runtime verified
- Actually running Host PID 11448 command line: `C:\Users\krado\Documents\NEXUS\nexus-host\nexus.mjs` (not the Git development checkout).
- Live power.mjs baseline SHA-256: `e8b0577f855a689f38d1f47891bfe1dc33c9601ebcf42e89e340ac52cd851b5c`.
- Actual live consent.mjs already requires signed owner approval for `system_power`, and has `logon_channel_attestation`. No change to consent policy necessary in live deployment.
- Live power.mjs has `onBeforeRestart` hook for consuming the owner's pre-logon attestation. Rebased code preserves this hook exactly.
## Scoped functional fix
- power dryRun now separates **verified remote recovery** vs **manual owner recovery** (with explicit warning, not falsely claiming WOL).
- When remote wake or login is not proven, actual S3 sleep, hibernate, shutdown and restart require existing one-off **signed owner approval**, never autonomous execution. Owner physically restores access on site.
- Unsaved document blocker remains; the power capability switch remains enforceable.
- Hibernation detection recognizes both Russian `Гибернация` and English `Hibernate`, and only available, not unavailable, states.
- `wake` and `power_on` remain blocked without verified independent hardware; this fix does NOT pretend to have finished Shelly commissioning.
- Restart/shutdown keep the original 60-second Windows grace; no forced-close `/f`.
## Regression
- Initial isolated power tests: 13/13 PASS.
- Rebasing to exact live running variant: dedicated signed-owner and restart attestation integration tests 5/5 PASS (no real power transitions).
- Existing older Git baseline integration suite: 3 pre-existing failures (stale `logon_attestation` catalog assertion, 44 vs 46 tool count, old `minimize_target_not_supported` vs current guard). Verified all three fail on unchanged source too.
- All test injections use fake executors; no sleep/shutdown/restart issued.
## Deployment boundaries
- Branch `experiment/nexus-power-manual-recovery-20261118`, independent Git worktree.
- ONLY corrected `power.mjs` is intended for actual live Host. Keep live `consent.mjs`, `server.mjs`, capabilities, supervisor and Gateway untouched.
- Deploy only if live pre-image SHA still equals baseline; use atomic backup and require platform's approval if it asks.
- After deployment the running Node Host still requires a controlled reload before the changed module is live. Verify new dryRun, verify tunnel and normal read-only tools. Do not put PC to sleep or shutdown just to test the fix.
