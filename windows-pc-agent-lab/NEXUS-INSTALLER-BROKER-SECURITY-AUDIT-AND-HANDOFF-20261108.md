# NEXUS Installer Broker — security audit, actual Windows tests and handoff

Date: 2026-11-08, Europe/Rome. 
Branch: `experiment/nexus-installer-broker-dual-auth-20261108`.
Parent: `experiment/nexus-prelogin-reboot-access-20261108`.
Status: **EXPERIMENTAL / ADMIN PROVISIONING NOT AUTHORIZED BY OS / NOT DEPLOYED**.

## User authorization and architecture

User approved work on a dual-path, restricted elevated installer: (A) direct explicit owner approval in chat; (B) owner click in NEXUS Live. Both should be *independent* and use one authenticated broker, never a generic privileged shell. User approved experimental development and previously installation of Chrome Remote Desktop. That owner approval is not a Windows UAC token.

User accepted current NEXUS Live v11 keyboard/windows controls. Preserve production Host/Gateway/main and Windows security; continue toward independent pre-logon recovery only after a trusted, tested remote access channel exists.

## Actual checked state

- Windows Host reachable, tunnel HTTP **200**, NEXUS version 0.6.1-next. No Host/Gateway restart or modifications.
- Official Google CRD MSI was previously downloaded and independently Authenticode verified as Google LLC: SHA-256 `1aef26d305b0091bba71589d3caaabe6db5a042648e5801969332086db7c1a90`, 24,616,960 bytes. Still staged; no second download.
- `Chrome Remote Desktop Host` **not installed**: read-only Win32_Service chromoting filter returns empty. Earlier ordinary installation failed MSI Error **1925** (no admin privileges).
- User’s unsaved Notepad untouched. No restart, shutdown, logoff, UAC change, administrator service, or scheduled task registered.
- Git working tree clean after moving an assistant-created test binary to recoverable `.nexus-trash`; base→branch `git diff --check` PASS.

## Original issues found in security audit and remedies committed

| Severity | Original issue | Experimental fix | Evidence |
|---|---|---|---|
| Critical | Privileged Task Scheduler would run `node.exe` directly and inherit untrusted `NODE_OPTIONS`, `NODE_PATH`, PATH, runtime preload | Pin *native* C# `NEXUS-Broker-Launcher.exe` as task action. It executes one immutable Node script, with an entirely replaced safe environment | C# built on real Windows; smoke test development copy exits 41, no child |
| Critical | PowerShell invoked in elevated context with executable name from PATH; possible command/module hijacking | Never call elevated PowerShell for ACL/admin token/signature; native .NET ACL and high token checks; elevated signer verification uses byte-for-byte preapproved SHA instead | Tests and code review |
| High | ACL checks initially omitted parent directories, imported modules and launcher | Native .NET checks ownership, non-writable Allow ACL for other SIDs, reparse points for Program Files modules, launcher, node binary, protected ProgramData directories and journal/staging | Fail-closed independent C# process; full OS provisioning still pending |
| High | Task XML scheduled an actual 2035 TimeTrigger | Removed; task has **no automatic triggers**, only owner-approved on-demand activation | XML test PASS |
| High | STOP was disconnected from actual owner `.nexus-host\owner-stop.json` | Check existing NEXUS persistent STOP and internal STOP before running, recheck immediately after durable claim but before MSI | Unit tests cover persistent, malformed and late STOP |
| High | Unknown installer result could be retried | Durable one-time claim written before effect, `outcome_unknown` / replay refusal | Unit test PASS |
| High | Forged allowlist data / ad hoc command / channel substitution | Ed25519 channel-specific verification with exact schema, SHA, validity 5 min, fixed MSI args and protected staging | Unit tests A/B, tamper/replay PASS |

Windows tests on actual owner's PC: **29/29 PASS** via Node test harness, exit 0; Windows C# compiler invoked in a developer workspace, production task not registered. First smoke test from %TEMP% returned UNKNOWN from Windows policy; the same test under an isolated developer checkout succeeded and remained unelevated. No security setting was weakened.

Source diff against base: 15 files, about 1022 lines at pre-document checkpoint; changes limited to new `nexus-installer-broker/` files and checkpoint notes. Never merged to main.

## CRITICAL remaining gates: do not install or call this ready

1. **Independent Claude review has not occurred.** Claude CLI is not discoverable on Windows (`where claude` and scoped PowerShell probe); TRINITY main session is inactive; no connected Claude plugin found; TinyFish profile does not report a Claude login. No other model's opinion may be invented. This document is an *internal engineering security audit and reviewer handoff*, NOT an independent Claude acceptance.
2. **Authentic chat owner authorization not yet implemented.** The existing code verifies separately signed `chat` and `live` grants, but uses **test Ed25519 keys** in the unit tests. ChatGPT tool arguments and the text of a chat are not cryptographically attested as a specific owner click. Must build a trusted owner-origin attestation OR a narrowly scoped advance owner-signed capability with exact package identity, expiry and budget. Do not mint signed authorization from a web page, model text, or ordinary MCP args.
3. **Real Live signer endpoint not integrated.** Existing Gateway supports passphrase-based owner approval and Ed25519 signing, but not an install grant endpoint. Integration requires its own challenge/nonce, CSRF controls, origin allowlist, owner session validation, complete two-channel E2E and review before any Gateway deployment.
4. **No OS-level bootstrap.** Admin-protected file copy, expected hash manifest, ACL creation and verification, certificate/private-key management, and task registration require actual Windows UAC or another already trusted admin channel. The current NEXUS Live cannot approve Secure Desktop UAC. Do NOT elevate current NEXUS Host, disable UAC, change Smart App Control or silently use SYSTEM.
5. **Need task and host identity verification on a first provisioning test.** Inspect Task Scheduler ACL/principal/elevation and native launcher bytes, runtime signer trust-store permissions, separate pre/post reboot status. Real service installer test must verify the installed **Google-signed service executable and version**, not only `sc query chromoting`, which is currently a weak postcondition.
6. **STOP while MSI is already running** is not yet a safely cancellable Windows Installer transaction. The code refuses before launch and never auto-retries unknown outcomes; it cannot promise that active MSI can be aborted without risk. Define safe transaction cancellation/finish policy and test.
7. Windows Login/secure desktop and cold power-on remain separate stages. `logonChannelVerified=false`, `wakeDevice=null`, Wi-Fi active but Ethernet disconnected; controlled reboot prohibited until owner has independently confirmed working pre-logon fallback and unsaved Notepad cleared.

## Independent Claude reviewer task — exact scope

Review only branch `experiment/nexus-installer-broker-dual-auth-20261108` against base `experiment/nexus-prelogin-reboot-access-20261108`.

Prioritize high-integrity Windows privilege boundary, Task Scheduler task/file ACL, .NET launcher elevation and environment scrub, restricted MSI executor, no arbitrary elevated command, two authentically owner-signed independent channels, Stop/unknown-outcome replay and multi-process races, malicious user-file input, secrets/log leaks, local cross-user IPC and future Google CRD enrollment. Provide specific file/line, severity, exploit, minimal fix, regression test. **Do not modify production/main/security; do not deploy.** Identify P0 blockers before UAC provisioning.

## Gate / next checkpoint

1. Obtain independent review through a genuinely connected reviewer; fix P0/P1 with tests in this experimental branch.
2. Implement trusted real chat and Live approval issuers with separate keys, without model-readable secrets.
3. Prepare one-time locally UAC-authorized admin bootstrap, verify protected ACL and pinned launcher as installed; run deny-only probe. One owner UAC approval may be necessary on real Windows — cannot simulate it via NEXUS Live.
4. Only after security review and E2E, install already verified Google MSI, configure Google PIN only in trusted owner UI, verify remote login from Samsung.
5. Only after verified owner remote pre-logon access and saving Notepad, perform controlled reboot and verify NEXUS recovery; power off/on requires separate independent wake mechanism.

**Production status: UNCHANGED. E2E admin install status: NOT RUN. Claude review: PENDING.**
