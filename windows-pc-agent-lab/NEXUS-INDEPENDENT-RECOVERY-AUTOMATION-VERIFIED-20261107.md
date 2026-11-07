# NEXUS — automated independent recovery acceptance, 2026-11-07 12:27 UTC

## Result: RESTORED AND INSTALLED; no additional installation performed

- `connection_status` at 12:27:49 UTC: **online**, Gateway reachable, tunnel HTTP **200**, Host `0.6.1-next`, no reconnects in 15m. Gateway production unchanged.
- Read original interrupted Live v4 installer journal `C:\Users\krado\Documents\NEXUS\_activate-live-v4-20261107-state.json`: last phase `stopping_host`, last event 09:49:25.582Z; backup verified and old PID Host 22604 / Supervisor 20656. Old updater was **not rerun**.
- Installed Host file hashes match verified pre-v4 baseline:
  - `server.mjs` d7133271cffd112eae3fe4877800a1979730e3e5b309b9d760333f1e1dbe7737
  - `catalog.mjs` eff2c49ab4b8078c43ed7b5ab9d706269bd054611d34a2e87f92799877ed26b8
  - `gui.mjs` 45a577daa93088d957b49359f6050707752c1c7a9f1ab878aad7b784a9e69acb
  - `uia-script.mjs` 1ea08d9d738fb78e5eded046c26ed6e1f675639ad00978261dd292f616664bbd
- Current Host PID **24288**; Supervisor PID **18880**, both visible in process inventory. Local `http://127.0.0.1:8765/healthz` returned `{"ok":true,"service":"nexus-host","version":"0.6.1-next"}`.
- Independent Scheduler task `NEXUS-Recovery-Independent` already installed by earlier recovery run (see `NEXUS-RECOVERY-WATCHDOG-REAL-INSTALL-CHECKPOINT-20261107.md`). At 12:27 UTC: state Ready, last result **0**, automatic one-minute recurrence confirmed. Summary at 12:27:43 UTC: `HEALTHY`, `healthy:true`, `hostAlive:true`, `supervisorAlive:true`, `ownerOff:false`. State `attempts:[]`; no unexpected Host launch.
- Recovery tests on real Windows: **11/11 PASS**. Installed Watchdog `node --check`: PASS.
- Existing recovery installer `--check` returned **`RECOVERY_INSTALL_STOP:existing_rescue_task`** (exit 20): expected fail-closed refusal to reinstall an already present task. This is **not** an installation failure; no duplicate task was created.
- Direct read of two protected STOP files through scoped file API requested owner approval, not used. Existing watchdog's own health decision independently reports `ownerOff:false`. No credentials or protected data read.
- No Host/Gateway v4 activation, Windows security changes, main changes, power changes, or edits to other Scheduler tasks.

## Remaining boundary

**Production outage failover drill remains unverified.** Do not claim the watchdog recovered a deliberately killed Host; that requires a separate safe drill with independent observation. Independent Watchdog installation, periodic execution and healthy-state evaluation are verified. The automation's recovery-and-install goal is complete; scheduled polling may be disabled. A separate OS-owned Live v4 updater effort belongs to another experimental branch and is not part of this recovery acceptance.
