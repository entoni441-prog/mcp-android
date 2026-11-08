# NEXUS pre-login recovery — CRD full logoff/login PASS
Date: 2026-11-08 Europe/Rome. Testing only; not a production configuration change.

## Confirmed

- Google-signed Chrome Remote Desktop Host installed, enrolled as `Antoni-ChatGPT`, owner confirmed remote screen control from Samsung, PIN authenticated directly with Google.
- Owner used CRD on Samsung to view Windows lock screen and unlock it successfully.
- `shutdown.exe /l` performed Windows user **sign-out** (not restart), returned exit 0.
- NEXUS tunnel became unavailable (Cloudflare HTTP 530) after sign-out, as expected for the user-session Host.
- Owner subsequently reported **«Вошёл»**, confirming access and sign-in from Samsung through independent CRD.
- Read-only follow-up at 2026-11-08 20:42 Europe/Rome:
  - NEXUS connection verdict `online`, Gateway 200, Host 0.6.1-next, uptime 102 sec, one tunnel reconnect, registered after the owner's re-login.
  - Windows `krado` console session ID 3 active, logon time 20:40; Explorer started in session 3; user unlocked.
  - Windows service `chromoting` is `Running`, `StartMode: Auto`, `StartName: LocalSystem`.
  - Previous `power_action({action:'restart',dryRun:true})`: `noUnsavedOwnerDocuments:true`, `autostartVerified:true`, `logonChannelVerified:false`, blocked only by `logonChannelVerified`.

## Boundary and next step

**Outcome: FULL LOGOFF / REMOTE LOGIN / NEXUS RECOVERY — PASS. Full reboot not performed.**
The remote access mechanism has been demonstrated prior to Windows user login; this is not equivalent to a tested full cold start or OS restart.

Current Host `nexus-host/capabilities.mjs` defines a separate, owner-set `logonChannelVerified` flag default false; it is stored in protected `%USERPROFILE%\.nexus-host\capabilities.json`. The current `set_capability` tool does not expose this flag. Do **not** bypass the safety gate by invoking `shutdown.exe /r` or changing protected configuration through an unreviewed generic command; do not misrepresent a sign-out test as a successful reboot test. A supported owner-confirmed attestation/one-time restart gate is required, with post-restart recovery validation.

No production/main, Windows security, NEXUS Host/Gateway, or live-session configuration changed in this checkpoint. No unsaved Notepad document was present during the prior no-unsaved check.
