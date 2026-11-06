# NEXUS NX-TM-01 — Safe Windows Terminal minimize without shell access

Date: 2026-11-06
Repository: entoni441-prog/mcp-android
Experimental branch: experiment/nexus-terminal-minimize-20261106
Base checkpoint: e8fd8dd01cf8ad65dd6db92392ad3dcfebbdac86
Status: STAGING IMPLEMENTED / UNIT ACCEPTED; NOT DEPLOYED

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

## STOP before production rollout

- Do not update installed Host or production Gateway or main without explicit owner authorization for those working instances and a rollback plan.
- After authorization, take immutable backups of exactly changed files, verify SHA and current clean status, stage both catalogs in sync, update only the specified modules via audited file operations, use existing Host restart/recovery mechanism (no reboot), and independently verify real minimize on the exact owner-identified terminal PID. Restore from backup on failure.
- Actual real WindowsTerminal UIA minimize action has not been executed under the new code yet, so positive real GUI acceptance is pending. Do not claim that the original window was minimized.
- Keep the Windows reboot test separate until NEXUS availability and owner logon recovery are verified.
