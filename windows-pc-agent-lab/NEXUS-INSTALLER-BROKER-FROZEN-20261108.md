# NEXUS Installer Broker — FROZEN (2026-11-08)

## Decision
Owner provided an addressable external review and selected a decision point: whether to use Chrome Remote Desktop manually. Decision: **freeze the restricted elevated Installer Broker prototype in the existing experiment branch and install Google Chrome Remote Desktop via the official, already verified MSI using one normal Windows UAC confirmation.** No Broker provisioning, production deployment, Gateway/Host modification or security policy change is authorized by this decision.

Reason: privileged persistent administrative task, two additional signing channels, ACLs, cryptographic keys, challenge/nonce, and maintenance impose disproportionate long-term attack surface for one pinned MSI installation. This is a P0 architecture / ROI issue despite 29/29 test PASS.

## Reviewer comments preserved
- **P1 (code):** `windows-pc-agent-lab/nexus-installer-broker/windows-io.mjs`, `runFixedInstaller` uses `spawnSync` with `timeout:5*60*1000`; terminating MSI during its transaction risks damaging an installation. Must change to safe transaction handling or indefinite observation without forced kill before ever enabling privileged Broker.
- **P1 (threat model):** `HighestAvailable` task triggerable by an ordinary user defeats repeated UAC prompts by design and introduces a privileged boundary. Signing private keys must be genuinely inaccessible to Host and ordinary user processes, profiles, environment and untrusted storage. Proven owner attestations must exist for both chat and Live, not just test Ed25519 keys.
- **P2 (verification):** `sc query chromoting` alone does not prove signed executable, proper service binary, publisher or version. Verify actual Windows service image and Google Authenticode.
- **Positive:** exact allowlisted MSI and flags; protected staging and repeated hash check; one-time durable claim, fail closed on unknown outcomes; persistent STOP before execution. Audit was targeted, not a full line-by-line review of all files.

## Definitive test and installation checkpoint
- Experimental branch: `experiment/nexus-installer-broker-dual-auth-20261108`; source at least through commit `81d5bcfbe526ed6741007bb8db03cc8c8b38cdc3` and security hardening afterwards; 29/29 Windows automated PASS at latest tested code.
- User's signed Google MSI already staged at `C:\Users\krado\NEXUS-workspace\downloads\chromeremotedesktophost.msi`, SHA-256 `1aef26d305b0091bba71589d3caaabe6db5a042648e5801969332086db7c1a90`, 24,616,960 bytes, Authenticode Google LLC Valid. Do not re-download unless file changed or official provenance requires recheck.
- Previous silent ordinary `msiexec /i ... /qn /norestart` returned exit 1603, installer Event 1925: **administrator elevation required**. This means a real Windows UAC approval is mandatory. Existing NEXUS Live cannot interact with UAC Secure Desktop. Do not claim that NEXUS owner Live approvals substitute for UAC.
- Prior state: Chrome Remote Desktop service not installed, User Windows still online; NEXUS Host/Gateway healthy. Unsaved Notepad document remains. Do not reboot or power off until verified independent remote-login fallback and Notepad saved.
- Do not start the UAC prompt remotely without confirming that the owner can actually see and approve it **on Windows or through a preexisting trusted secure-desktop remote control**. If unavailable, leave PC usable and provide the exact already staged MSI path; one physical/admin approval is unavoidable under current architecture.
- After normal installation: independently inspect service image path and signature, confirm remote host is enrolled at `https://remotedesktop.google.com/access` with owner login and unique PIN entered **in Google's secure UI**, then owner confirms successful remote access from Samsung even at Windows lock screen. Only then controlled reboot; after reboot verify service and NEXUS restore. Cold power-on requires separate independent Wake-on-LAN/hardware path.
- Work to retain: owner requirements of two independent permission modes (chat, Live), but defer privileged background broker until there is a recurring pattern of admin installs, defensible scoped privilege and true independent review.

**Disposition: Frozen, no production changes or Windows changes in this checkpoint.**
