# NEXUS Independent Recovery v1 — 2026-11-07

## Why ChatGPT currently lost Windows access

ChatGPT's NEXUS MCP tools reach an OAuth-protected Cloudflare Gateway, then the NEXUS Host through a quick tunnel. The v4 Host updater was started as a child of NEXUS and stopped the Host + Supervisor; both the connection and the updater's result became unavailable. Status after the failure: Cloudflare tunnel HTTP 530; Gateway still serves v3; no independently reachable Windows tool exists. Even though `NEXUS-Guardian-Preboot-Watch` was installed, that task is a read-only STOP/health observer and **cannot restart** Host.

## Recovery layer implemented here

This branch adds an **independent Windows Task Scheduler watchdog**, separate from the NEXUS Host, its Supervisor and the existing read-only Guardian observer.

Components:
- `recovery-policy.mjs`: pure fail-closed recovery decision, 3 attempts / rolling 30 min, minimum 2-min spacing, budget reset only with stable health, owner-off honored.
- `recovery-watchdog.mjs --once`: runs on the Windows interactive user's Scheduler task each minute; checks only `127.0.0.1:8765/healthz`, `host.pid`, `host-off` and the exact registered `NEXUS-Host-Run` task identity. If it is safe and necessary, requests **only** `schtasks /Run /TN NEXUS-Host-Run`. No arbitrary shell/model command, no task deletion, no STOP clearing, no power/logon, no remote inbound listener. Writes sanitized state and summary to `%USERPROFILE%\\NEXUS-workspace\\nexus-recovery-independent`.
- `install-recovery.mjs --check|--install`: creates a separate least-privilege, interactive-user scheduled task `NEXUS-Recovery-Independent`; 1-minute interval, owner-logon trigger, IgnoreNew policy, 45-second execution limit. Does not overwrite installed Host or existing Scheduler tasks.
- Tests for scheduler identity, owner host-off, persistent restart budget, logon security boundary and valid XML.

### Verification

GitHub Actions [run 42366717286](https://github.com/entoni441-prog/mcp-android/actions/runs/42366717286): **Windows PASS, Ubuntu PASS** for watchdog policy, scheduler XML and syntax.

**Important: these are code and CI PASS, not actual installation or real Windows recovery.**

### Current installation status (authoritative)

- **NOT installed on owner's Windows** because its existing NEXUS tunnel is down.
- Production Gateway remains v3 (version `7c0a8cb1-cb4d-4aea-850f-79305e900d5a`).
- Live v4 Host attempt remains unresolved; before touching anything else, inspect `C:\\Users\\krado\\Documents\\NEXUS\\_activate-live-v4-20261107-state.json` and exact hashes after regaining connection.
- Do not deploy Gateway v4, rerun the previous in-Host activation or assume rollback has happened.
- Old `NEXUS-Guardian-Preboot-Watch` remains read-only; do not repurpose it or change user power/Windows security settings.
- This layer is *self-healing while Windows user session and network are available*, not a second remote desktop connection. It cannot unlock Winlogon, turn on an off PC, fix networking without local access, or automatically repair corrupted executable files. A separate authenticated rescue poller/Cloudflare channel may be designed and tested later to address the latter case; no cloud remote command surface is introduced in v1.

### Exact next recovery checkpoint

Once local Windows is available, one owner-issued **existing task launch** may restore the original channel:

`schtasks /Run /TN "NEXUS-Host-Run"`

Do not install the new watchdog until NEXUS has reconnected and the prior v4 updater's on-disk state is known. Then:

1. Read the v4 updater state and verify 4 installed Host file hashes; recover the base from the previously verified backup if needed using an independent OS-owned activation (never a child killed with Host).
2. Verify Host health and Supervisor, and that STOP remains sticky.
3. In an isolated checkout of this branch, run `node recovery/install-recovery.mjs --check` then `--install` only if local preflight passes.
4. Verify the separate Scheduler task is registered with the correct executable/owner and read fresh summary after `schtasks /Run /TN "NEXUS-Recovery-Independent"`.
5. In a controlled non-production test session, stop a *test Host* only and confirm bounded scheduler recovery, then consider a live maintenance drill with rollback.
6. Only after Independent Recovery is truly accepted resume coordinated Live v4 Host/Gateway rollout.

### Security note

Interactive User task requires an already signed-in Windows session; while locked, it may continue working, but it does not provide pre-logon credential control. The user did not authorize disabling Smart App Control or setting Windows auto-login. Never set `logonChannelVerified` without actual independent remote-login acceptance.

### Additional guarded revision / final CI

- If the independent existing Supervisor PID is alive, the Watchdog records `SUPERVISOR_PRESENT_WAIT` and **does not** start a parallel Host; it does not kill or bypass the Supervisor.
- Malformed persisted restart budgets or PID metadata cause `CORRUPT_STATE_STOP`, not silent counter reset or uncontrolled restart.
- Latest source safety commit `5ae1518cd4aa9fabad667289edc4b2aa132cd166`; GitHub Actions [run 42367001503](https://github.com/entoni441-prog/mcp-android/actions/runs/42367001503) **PASS on Windows and Ubuntu**.
- Still no local activation on owner PC: cloud-only CI cannot reach the actual offline Windows Session.
