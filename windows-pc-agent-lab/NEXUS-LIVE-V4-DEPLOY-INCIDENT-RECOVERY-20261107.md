# NEXUS Live v4 deployment — INCIDENT / recovery checkpoint

Date: 2026-11-07 Europe/Rome.
GitHub code checkpoint: `64a1c0895ce4dbe2ffc4fd3b60a2c6c9672a48dc` for the deployment script.
Experimental source base: `de0b6a7ef757f376cfe8eecc1e9842d46dbda05a`.
Production Cloudflare Gateway remains at `7c0a8cb1-cb4d-4aea-850f-79305e900d5a`, 100% traffic — LIVE V3, UNCHANGED.
Production Host before update: `0.6.1-next`, pid `22604`; Supervisor pid `20656`.

## Verified preparation
- Git clone `C:\Users\krado\NEXUS-workspace\nexus-live-v4-deploy-20261107` with experimental branch; four Host source files correspond exactly to SHA-256 pinned by install script.
- Installed Host source comparison against v3 baseline: server/gui/uia-script matched text; installed catalog is older v1 resource only; four-file update does not replace unrelated Guardian/Supervisor files.
- All v4 Windows+Ubuntu CI checks PASS on run `42359414706`.
- Script `nexus-host/install/activate-live-v4-20261107.mjs` syntax PASS and `--check` returned `PREFLIGHT_PASS`, identifying genuine Host and Supervisor.
- Owner explicitly approved deployment and backup, no further authorization needed for ordinary safe work, but Host policy approvals remain binding.

## Attempt / exact observed state
- `run_command node.exe install\activate-live-v4-20261107.mjs --deploy`, command id `c-cdd1c2a31d`, returned `state:running`, stdout `BACKUP_VERIFIED; update scheduled; NO secrets printed`.
- After the updater's controlled stop of Supervisor/Host, MCP calls failed `pc_offline`. Repeated **diagnostic checks** returned Cloudflare 530 / `tunnel_unavailable`, with registration age growing and no recovery as of `2026-11-07T09:53:07Z`.
- This is NOT a confirmed successful Host upgrade. The on-disk activation journal `C:\Users\krado\Documents\NEXUS\_activate-live-v4-20261107-state.json` is inaccessible through MCP until the Host channel returns.
- A likely cause is that the updater was launched as a child of the same NEXUS Host whose process it later stopped. NEXUS commands run inside a Windows Job; terminating the Host may terminate the updater while Supervisor is already stopped. Treat as a **hypothesis** until the state file is read.
- Gateway v4 was **not** deployed, to avoid a half-upgraded stack; no `main` / Windows security changes.
- Original four-file backup was reportedly verified by updater, at `C:\Users\krado\Documents\NEXUS\_backup-live-v4-pre-20261107`. Current content of installed four files and actual rollback status remain UNKNOWN.

## Safe independent recovery
1. Do not run a second in-Host activation attempt or push Gateway v4.
2. If an out-of-band independent Windows management channel remains available, start the existing Windows Scheduler task `NEXUS-Host-Run`, rather than reinstalling or rebooting. One owner Windows action if unavoidable: Win+R, `schtasks /Run /TN "NEXUS-Host-Run"`, Enter.
3. Once NEXUS returns, read the activation state file and check SHA-256 of all four installed files against OLD/NEW in script. Confirm Supervisor process and local health, check `tools/list` whether `owner_ui_pref` exists.
4. If installed files partially changed or Host is not ready, use verified four-file backup and an **independent** process to restore; no blind rerun of a possibly partially completed activation.
5. Rework activation path: the restart orchestrator must run independently of the Host's Job, preferably an audited one-shot scheduled task that is registered and proven alive before the Host is stopped. A standalone recovery trigger must remain after both Host and Supervisor exit.
6. Only then finish coordinated Gateway v4 publication (with v3 rollback), plugin refresh and live Samsung acceptance.
