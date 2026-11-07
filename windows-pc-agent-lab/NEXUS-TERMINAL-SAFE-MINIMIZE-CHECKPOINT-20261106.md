# NEXUS NX-TM-01 — Safe Windows Terminal minimize without shell access

Date: 2026-11-06
Repository: entoni441-prog/mcp-android
Experimental branch: experiment/nexus-terminal-minimize-20261106
Base checkpoint: e8fd8dd01cf8ad65dd6db92392ad3dcfebbdac86
Status: PRODUCTION DEPLOYED / REAL WINDOWS MINIMIZE VERIFIED (2026-11-07)

## User-visible defect

The owner explicitly asked the assistant to minimize WindowsTerminal `C:\Program Files\nodejs\node.exe` before lock/restart, but the installed NEXUS GUI `mouse_action` returned `owner_action_required`/`shell_command` for the minimize button. The existing policy treats all mouse input into a terminal as potentially command execution. This protection is intentional; a generic bypass or removing WindowsTerminal from DENY_APPS is forbidden.

## Exact implementation

- New opt-in `minimize_window({pid, title?, ownerRequested:true})` MCP operation dedicated to WindowsTerminal. It accepts no text, key, button, command, or arbitrary executable. Only an explicit owner request in chat can permit it, plus `gui_input` and `grantsFromChat`.
- `gui.mjs` selects exactly one top-level WindowsTerminal window via UIA-reported PID+HWND. Multiple matches return `ambiguous` without acting. Any mismatch or different app is denied.
- `uia-script.mjs` adds a fixed `minimize` mode using the Microsoft UIAutomation `WindowPattern.SetWindowVisualState(Minimized)` API, never keyboard/Robot/mouse. Before/after it checks same PID/HWND and WindowsTerminal process and verifies the minimized state; no success is reported on an unverified effect.
- `session.mjs`, `server.mjs` and the byte-identical Host/Gateway `catalog.mjs` expose the one narrowly scoped operation, with NEXUS STOP/lease/stale-target handling intact.
- All existing `mouse_action`, `keyboard_action`, shell command, UAC and logon prohibitions remain unchanged. No generic shell-window interaction was unlocked.

## Tests and evidence

- On owner's REAL Windows machine, `node --test --test-concurrency=1` of `gui.test.mjs`, `policy.test.mjs`, `server.test.mjs`, `session.test.mjs`, `terminal-minimize-contract.test.mjs`: 71 tests, 71 PASS, exitCode 0.
- New tests verify exact owner intent, single-window disambiguation, process/HWND mismatch fail-closed, no robot action, preserved shell input hard-denies, MCP request rejection without owner intent, synchronized Host/Gateway catalogs.
- Windows PowerShell 5.1 parses the full fixed UIAutomation PowerShell script successfully (AST, without executing GUI operations). The parser test explicitly writes UTF-8 BOM so existing Cyrillic UIA expressions parse correctly under Windows PowerShell 5.1; production already uses UTF-16 encoded fixed script.
- Independent GitHub Actions run 42306352626: Windows-latest PASS, ubuntu-latest PASS.
- https://github.com/entoni441-prog/mcp-android/actions/runs/42306352626

## Installed Host checkpoint, verified without changing it

- Host diagnostics: NEXUS 0.6.1-next; installed source directory `C:\Users\krado\Documents\NEXUS\nexus-host`.
- Verified installed `gui.mjs`, `uia-script.mjs`, `policy.mjs`, `catalog.mjs` and `session.mjs` are text-identical to the base branch. `server.mjs` reading is partially secret-redacted by NEXUS and therefore cannot safely be reconstructed from that read; use the committed source and verify version/rollback before any rollout.
- The installed `NEXUS-Host-Run` task runs from its existing source path. It was NOT changed or restarted.
- Production NEXUS Gateway/Host catalogs remain at the old version. The tool must be deployed together to Host and Gateway and MCP tools re-discovered before it appears in the current chat session.

## Historical staging gates (satisfied after explicit owner approval on 2026-11-07)

- Do not update installed Host or production Gateway or main without explicit owner authorization for those working instances and a rollback plan.
- After authorization, take immutable backups of exactly changed files, verify SHA and current clean status, stage both catalogs in sync, update only the specified modules via audited file operations, use existing Host restart/recovery mechanism (no reboot), and independently verify real minimize on the exact owner-identified terminal PID. Restore from backup on failure.
- Actual real WindowsTerminal UIA minimize action has not been executed under the new code yet, so positive real GUI acceptance is pending. Do not claim that the original window was minimized.
- Keep the Windows reboot test separate until NEXUS availability and owner logon recovery are verified.

## Production deployment + real Windows acceptance (2026-11-07)

- Owner explicitly authorized deploying the patch to the working Gateway and Host with backup and restarting the **Host only**, not Windows.
- Confirmed existing installed Host modules (gui.mjs, uia-script.mjs, catalog.mjs, session.mjs, server.mjs) matched Git blob content for the baseline commit e8fd8dd01cf8ad65dd6db92392ad3dcfebbdac86; the NEXUS read tool redacts sensitive tokens in server.mjs so Git object SHA was separately compared using the OS git hash-object command.
- Patched 5 Host source modules in `C:\\Users\\krado\\Documents\\NEXUS\\nexus-host` with optimistic SHA preconditions, automatically backed up originals into the private `C:\\Users\\krado\\.nexus-host\\backups` directory. No Windows security configuration, production main branch, unrelated apps, or Windows power action were changed.
- Gateway local `src/catalog.mjs` installed with backup. Gateway catalog owner test adjusted in local test folder and experiment branch; existing OAuth, bindings, and deployment configuration untouched. Gateway 34/34 local regression PASS. `wrangler deploy --dry-run` exit 0 after owner approval, then `wrangler deploy` separately owner-approved and exit 0.
- Cloudflare Gateway production deployed version: **18912975-a18d-40ba-aa51-017411939140** at 2026-11-07T05:33Z (100% traffic); prior rollback version: **b6c89bc7-e99e-4042-8762-34524d4363dd**. Post-deploy `GET /health` HTTP 200; unauthenticated `POST /mcp` HTTP 401 (fail-closed); existing OAuth/secret and Durable Object bindings preserved.
- NEXUS supervisor PID **20656** was verified independently alive before restart; `host-off` absent; original Host PID **23324** stopped. Remote connection returned Cloudflare HTTP 530 temporarily, then supervisor recovered the Host automatically without manual PC action or Windows reboot; new Host PID **22604**, registered at **2026-11-07T05:35:05Z**; connection_status verdict online, tunnel probe HTTP 200.
- Because the current ChatGPT session advertised the *pre-refresh* 42-tool NEXUS schema, the new method was exercised through the authenticated local NEXUS MCP HTTP endpoint without revealing the locally stored token. The active Host returned **44 tools** including `minimize_window`.
- Initial call correctly returned `stale_args` after Host resume; the target was freshly re-observed using `list_windows`, with WindowsTerminal PID **20196**, unique title `C:\\Program Files\\nodejs\\node.exe`. The subsequent scoped owner-requested MCP call returned `{status:"minimized",process:"WindowsTerminal",pid:20196,verified:true,shellInputSent:false}` (PASS).
- Independent screenshot afterwards shows **bare Windows desktop** rather than the terminal; `WindowsTerminal` PID **20196** still exists and the Node process **20224** remained running. No terminal commands typed, no processes killed by minimize, no owner changes lost.
- Live View widget shown to the user in ChatGPT; host connection still online, HTTP 200. The Windows lock-and-reboot acceptance test is a **separate, not-yet-executed step**.
- Native Windows regression 71/71 PASS; GitHub Actions run 42306352626 both Windows and Linux PASS before production rollout. Gateway production local suite 34/34 PASS after catalog change.

## Operational follow-up

- ChatGPT NEXUS connector may cache the previous schema in a previously started chat; rediscovery will surface the new `minimize_window`. The method was proven through the actual authenticated local MCP server; do not claim the current ChatGPT connector has refreshed yet.
- Keep all backup files until new tooling and the independent reboot recovery tests are accepted. Do not delete them automatically.
- Do **not** assume the pending Windows lock/login channel is verified: `logonChannelVerified=false` was the last reboot blocker and was not changed as part of this patch.
