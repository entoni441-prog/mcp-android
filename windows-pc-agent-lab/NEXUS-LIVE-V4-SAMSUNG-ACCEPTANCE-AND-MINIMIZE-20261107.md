# NEXUS Live v4 — Samsung acceptance and safe terminal minimization (2026-11-07)

Environment: Android Samsung ChatGPT mobile app, NEXUS production Host `0.6.1-next` with v4 patches, Gateway Live v4 production version `884e9cc9-d13b-4ff4-a4d7-b5d588e79f57`, 100% traffic. Experimental branch only; no main modifications.

## Observed by owner on phone
- **PASS**: Live touch control can be enabled.
- **PASS**: Calculator reacts to touch; digits entered successfully.
- **PASS**: Live v4 native text popup brings up Samsung keyboard.
- **FAIL / restricted target**: Attempt to use Live touch to minimize a desktop window resulted in `mouse_action -> owner_handoff_active`.
- Host records showed `shell_command` handoffs `h-50f67077b8` and `h-b1667f42c1`, referencing `WindowsTerminal "NEXUS Host — LIVE VIEW ON"`; additional taps after handoff were blocked. Both were later `unverifiable`, and live input became unblocked without weakening STOP/security.
- At least one touch operation was `mouse_action ok:true`, proving Live input can reach a permitted desktop surface.
- Current logs are insufficient to assert whether Calculator's **own** minimize button was the original touch target; error evidence identifies protected terminal shell access, not an unrestricted minimize API defect.

## Windows Terminal root-cause analysis
- `list_windows` grouped two separate top-level Windows Terminal windows under PID **20196**, which is why `minimize_window(pid=20196)` originally returned `ambiguous`.
- Read-only UIAutomation enumeration via PowerShell showed:
  - HWND **3147020**; title `NEXUS Host`; `WindowVisualState=Normal`; non-offscreen.
  - HWND **3016000**; title `C:\\Program Files\\nodejs\\node.exe`; `WindowVisualState=Minimized`.
- After a one-time `stale_args: task_resumed`, refreshed the window list read-only; dedicated `minimize_window({pid:20196,title:"NEXUS Host",ownerRequested:true})` returned **`{status:"minimized",verified:true,shellInputSent:false}`**.
- Host remained **online**, tunnel HTTP **200** after the operation. No shell text/input, no process termination. Owner's previous direct instruction to minimize exactly that window was already recorded in chat.
- **PASS**: safe, exact-title Windows Terminal minimization works. **Not yet PASS**: generic touchscreen minimization in Live; terminal GUI input intentionally hard-denied by policy.

## Recommended next development, no deployment yet
- Avoid creating persistent owner handoffs from accidental touch on terminal titlebar; instead surface a simple protected-surface message and offer an explicit **Minimize window** action that routes to the dedicated `minimize_window` Host operation after owner approval and exact HWND verification.
- Improve `minimize_window` diagnostics for duplicate PID windows (return HWND, visible/minimized state without secret title content), and optional exact window selector while maintaining `WindowPattern` revalidation. No arbitrary shell mouse/keyboard.
- Verify Calculator minimize separately if requested, since UWP Calculator's titlebar may belong to the protected `ApplicationFrameHost`; do not generally allow `ApplicationFrameHost` mouse input.
- Restore an owner-initiated Live session using ▶ (instead of needing agent to call `watch_nexus`), without opening a remote control session without consent. Keep STOP and credential boundaries.
- Existing flashing task issue remains independent of this touch acceptance.
