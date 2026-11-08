# NEXUS v10.1 — Host installed, recovery verified
Date: 2026-11-08 ~11:16 UTC. Status: **HOST INSTALL PASS / SAMSUNG TOUCH E2E PENDING**.

## Scope and authority
Owner expressly authorized installation of Claude's reviewed one-file fix `3d705a5b4bdebd06ee8cbaf37ddaf65b146c5d0c`.
- GitHub working branch for guarded activation: `experiment/nexus-v10-1-host-install-20261108` (derived from `experiment/nexus-v10-no-sticky-shell-click-20261108`).
- GitHub `main`, Gateway Worker and Windows security settings **NOT changed**.
- Modified only production Host source `C:\Users\krado\Documents\NEXUS\nexus-host\gui.mjs`.
- No owner passphrase or Terminal command was used in the patch.

## Why
Real Samsung v10 failed caption Minimize due to first click in terminal content triggering `shell_command` owner handoff, which blocked every later caption action. The 5-line change in Host `gui.mjs` rejects terminal mouse clicks/drag with `terminal_content_refused` and no handoff; keyboard shell commands remain protected. Claude's new test verifies that a refused terminal click cannot prevent a later properly verified `minimize`.

## Preflight
- Before deployment installed `gui.mjs` SHA-256: `b544780e275a0c4bcb775c115fc28fbc7752217be9b6675b2edb1f4d86cc29c1`.
- Source from Claude commit `3d705a5` SHA-256: `11f8d180d26395ea224238d66f74327c0cf90e6b74d999d7a0e8290e68e32946`.
- Independent tests on clone: **42/42 PASS** (`titlebar-gesture.test.mjs`, `natural-touch.test.mjs`, `terminal-minimize-contract.test.mjs`, `gui.test.mjs`).
- `node --check` new activation scripts both exit 0; controller `--check` returned `PREFLIGHT_PASS`.
- Recovery Watchdog was previously registered Ready with lastResult 0.

## Safe independent installation
- One-use Windows Scheduler task: `NEXUS-Shellclick-v101-Activation`, distinct from all prior activations.
- Controller `schedule-os-owned-shellclick-v101.mjs`: `--prepare` → PREPARED_UNARMED; `--probe` → SCHEDULER_INDEPENDENT_PASS (probe PID 19912); `--arm` → ARMED; `--start` → OS_OWNED_ACTIVATION_REQUESTED.
- Activation script `os-owned-activate-shellclick-v101.mjs` executes as standalone OS-owned Scheduler task, refuses connected Host ancestry, checks exact Host+source hashes and process identity, creates backup, arms recovery maintenance marker, stops Supervisor and Host, replaces **one file**, restarts via NEXUS-Host-Run, verifies health and tools. Rollback path exists.
- Journal: `C:\Users\krado\Documents\NEXUS\_activate-shellclick-v101-20261108-state.json`. Read back via NEXUS: final phase **`installed_verified`**, at `2026-11-08T11:15:16.528Z`, health true, toolsVerified true. Phases: backup_verified → maintenance_armed → stopping_supervisor → stopping_host → installing → files_installed_verified → scheduler_started → installed_verified.
- New Host PID **23840**, Supervisor PID **25816**. Old Host 23324, Supervisor 13132.
- Installed `gui.mjs` SHA-256 **`11f8d180d26395ea224238d66f74327c0cf90e6b74d999d7a0e8290e68e32946`**, byte-identical to expected.
- Backup: `C:\Users\krado\Documents\NEXUS\_backup-shellclick-v101-pre-20261108\gui.mjs` SHA-256 **`b544780e275a0c4bcb775c115fc28fbc7752217be9b6675b2edb1f4d86cc29c1`**.
- Tunnel Cloudflare 530 while restart, recovered to HTTP 200. `connection_status`: gateway ok, Host reachable `0.6.1-next` and reconnect registered ~11:15:16 UTC. `host_diagnostics`: ownerAction **null**, pendingConsents **0**, Live ready.
- No rollback needed. No production Gateway update: existing v10 Worker `38a2f14b-724d-4686-8e90-c17b2dfa978e` remains in service.

## Next necessary acceptance (real Samsung)
1. Open a **new** Live v10 card in current chat using `watch_nexus`.
2. Owner opens NEXUS Host Window from Windows taskbar if necessary, zooms to its titlebar and taps **−**. Expected Host audit: `mouse_action -> minimize, verified:true, shellInputSent:false`, no `owner_handoff_active`.
3. Owner holds on the **blank titlebar** 0.5 s and drags, release. Expected: real window moves with verified native action; zoomed *image* pan is not a substitute.
4. If these fail, read audit and inspect only the failed action. Do not alter working Host/Gateway or repeat installation without new owner approval.

**Important:** This checkpoint confirms recovery and installed bytes, NOT the actual mobile minimize/drag experience.
