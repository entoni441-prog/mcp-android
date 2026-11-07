# NEXUS Live v4 — mobile touch + Samsung native input checkpoint

Date: 2026-11-07 Europe/Rome.
Branch: `experiment/nexus-live-v4-touch-20261107`.
Verified implementation commit: `d05cd81e185cd8f8b7cc598652bc502206a63f0c`.
GitHub Actions: [42359414706](https://github.com/entoni441-prog/mcp-android/actions/runs/42359414706) — Windows PASS, Ubuntu PASS. Both jobs run Gateway owner/auth regressions, touch input and recovery behavior, Host STOP/session/GUI tests, byte-identical catalogs, and Wrangler dry-run. No deployment performed.

## Problem reproduced on Android Live v3
- First touch after a resumed task was rejected by Host with `stale_args: task_resumed`. Prior read-only checks before the FIRST GUI action did not fix this because the Host sets its reobserve flag during `tasks.stage()`, after the work session attaches.
- v3 implemented only single click, no double tap.
- Owner had to re-enable touch mode for each new Live iframe.
- The text panel occupied substantial height rather than appearing on demand. Native Samsung IME integration needed.
- Watch-only lease expires after 45 s without activity.
- Windows passwords, PIN, OTP and other secrets must never go through the normal model-visible `keyboard_action` tool.

## v4 changes
1. The widget catches ONLY a demonstrably pre-execution Host refusal `stale_args: task_resumed|owner_stop_resumed|owner_pause_resumed`, obtains fresh `list_windows` and `live_frame` automatically, validates fresh primary screen geometry and recency, then repeats the action at most ONCE. For timeouts, other errors, STOP, changed screen or uncertain outcome: NEVER replay. Isolated helper `callOnceAfterStale` has behavior tests for each branch.
2. Delayed single tap vs double tap: within 330 ms and 40 screen pixels one `double_click` is sent, without a preceding `click`. On single tap emit one click after 340 ms.
3. ChatGPT Live widget uses an overlay composer only when a verified non-password editable field was clicked or the owner taps the keyboard button. The HTML `input type=text inputmode=text enterkeyhint=send` requests the native Android/Samsung keyboard and Enter submits the form. Native keyboard opening from an async focus remains to be verified on a real Samsung; owner can tap the input if Android blocks programmatic focus.
4. New app-only `owner_ui_pref` Host tool persists a BOOLEAN owner touch preference to `owner-touch-pref.json` (no secret). Restore it in new ChatGPT Live widgets. Does not grant `gui_input`, lift a STOP or bypass policy. STOP and owner revocation clear it, even if no session is active.
5. Explicit opt-in control keeps a watch-only session alive via lightweight `get_capabilities` while the widget is visible, for no more than 10 min since the most recent owner interaction/activation; no frame without active session; STOP remains available and sticky.
6. Host UIA marks `isPassword` from AutomationElement.Current; unknown property is treated as sensitive. Host refuses ordinary keyboard input into a known password element, or an Edit/Document/ComboBox whose password flag cannot be positively verified. Widget auto-opens its composer only with `target.isPassword===false`.
7. `ui://nexus/live-view-v4.html` is the new resource; legacy v3/v2/v1 remain listed. Host/Gateway tool catalogs stay byte-identical. New Host tool requires a Host upgrade, and new resource requires Gateway deployment/ChatGPT Refresh.

## Verification and release constraints
- PASS: GitHub Actions 42359414706 Windows and Ubuntu.
- PASS: Host preference persistence and reset on STOP; no permission elevation.
- PASS: simulated pre-execution retry exactly once and no retry on network/other/uncertain failures.
- PASS: HTML widget syntax, status/owner-popups, geometry test, double tap and Android native input markup; Wrangler bundle dry-run.
- PASS: Host protected field checks with fake UIA tests; existing other Host GUI tests.
- NOT VERIFIED on a physical Samsung: actual IME popup on click, touch retry against real resumed task, double-tap target, 10-min watch lease.
- Production still runs Live v3 Gateway version `7c0a8cb1-cb4d-4aea-850f-79305e900d5a`; prior rollback version `8e3735e6-eb73-4e42-9710-f0ea63214b8c`. Current installed Windows Host remains unchanged.
- Do not modify `main`, production Host/Gateway or Windows security settings without a fresh explicit deployment authorization. Upgrade Host and Gateway as one coordinated release with backups and rollback. Refresh ChatGPT MCP tools, then verify on Samsung.
- If host-only or gateway-only update is not coordinated, the v4 widget will show `owner_ui_pref_unavailable` and refuse to pretend persistent input works. Do not deploy Gateway v4 alone.
