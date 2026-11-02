# NEXUS 0.5.2 — Owner Pause / Resume / Window Lifecycle, 02.11.2026

Scope: actual Windows PC via NEXUS MCP. All times UTC. Tested only fake data. No Host/gateway/security configuration modifications, no rollback. Results reflect tool responses, not assumptions.

## Environment
- `connection_status` 20:14:45Z: gateway=ok, host=reachable, version=0.5.2, verdict=online, tunnel=ok.
- `get_capabilities`: gui_input=true, ui_read=true, screen_capture=true, live_view=true; no capability changes.
- `live_control` schema includes status/stop/resume; `watch_nexus` supplied a live-view widget with STOP in the host UI.

## Sequential acceptance
| Scenario | Verdict | Evidence |
|---|---|---|
| Host and Resume availability | PASS | version=0.5.2, online. `live_control({action:"resume"})` → `resumed:true`, `ownerPauseCleared:true`, `state:"ready"`. |
| Explorer NEXUS-owned window | PASS | `open_app explorer` → started, createdByNexus windows ["Главная — проводник"] / tabs ["Главная"]. Process explorer PID 7276, `CabinetWClass`. |
| Owner takeover on mouse movement | PASS | 20:16:53Z `focus_window` refused: `owner_active`. Audit `owner_pause, why:"mouse"`. No retries of GUI input while paused. |
| No spontaneous Resume after ~1min | PASS | 20:18:02Z `lease_expired` while paused; `get_capabilities` `ownerPaused.why="mouse"` even after session ended. Audit has no autonomous resume between pause and explicit command. |
| Explicit Resume & checkpoint continuity | PARTIAL | At 20:22:24Z owner command received and `live_control resume` lifted pause; `lastInterrupted` still task `t-554f93f86836` with interrupted stage `focus_window`. At 20:22:29Z Explorer window already foreground; no redundant focus/open call performed. The resumed work began **new session `cc248fc07675` and new task `t-01e1f69d3c7a`**, so the same task ID was NOT restored. Owner-pause release PASS, same-task N-08 recovery NOT CONFIRMED; evaluate as a continuity gap, not an auto-resume success. |
| Fake-data GUI operation | PASS | Navigated to `%USERPROFILE%\\NEXUS-workspace\\NEXUS-test` (previous attempt at Documents path had not navigated); `window_info` "NEXUS-test — проводник"; `inspect_ui` 4 list items; clicked `a.txt` only; screenshot showed selected 1 item / 17 bytes. `list_dir`: `.env`, `a.txt`, `b.txt`, `nexus-test-token.txt` all present. No file content accessed or modified. |
| One-window-at-a-time lifecycle | PASS (policy enforcement) | Attempted `open_app calculator` while owned verified Explorer still open → `nexus_window_not_closed`, instructed close previous window. This is expected guard, not an arbitrary failure. `close_window` Explorer PID 7276, title NEXUS-test → `closed:true`, `by:nexus_owned`; verified no `CabinetWClass` Explorer window remained. Then `open_app calculator` → started, createdByNexus ["Калькулятор"]; `window_info` PID 3716 name "Калькулятор"; `close_window` → `closed:true`, `by:nexus_owned`. |
| Live View and STOP availability | PASS availability only | `watch_nexus` response `state:"active", streaming:true`, UI offered STOP. STOP button not pressed (test requested owner mouse pause, not actual emergency stop). |
| Finish & cleanup | PASS | `finish_task` at 20:25:21Z: `ended:true`, `active:false`, `liveActive:false`, windows.closed=[], windows.left=[], browser.remaining=0, `framesAfterStop=0`. Subsequent `get_capabilities` active=false, `live_control status` ready/streaming=false/viewing=false, Explorer PID 7276 only Shell_TrayWnd and Progman, `list_processes Calculator` count=0; all four fake files unchanged. |

## Notable technical detail
- Initial paused task: `t-554f93f86836`, session `ed0316a4cac6`, status `interrupted`, `lease_expired` at 20:18:02Z (69 seconds after mouse pause).
- Explicit `owner_pause_cleared` at 20:22:24Z after 331 sec paused.
- Resumed actions created session `cc248fc07675`, task `t-01e1f69d3c7a`; `finish_task` marked this new task `finished`.
- `window_info` on Calculator PID after closing returned `app_not_allowed: target_unknown`, consistent with disappeared window, confirmed by process count 0; no retry or escalation.
- `finish_task` timing: `receivedAt=2026-11-02T20:25:21.140Z`, `hostTotalMs=2`, `framesAfterStop=0` (not a stopwatch-based STOP latency measurement).
- No password manager, payment or personal file was touched.

## Conclusion
Owner mouse pause, persistence without spontaneous resume, owner-directed release, window sequencing and cleanup were genuinely tested successfully. **Full "resume same task ID/checkpoint" remains unverified / continuity gap**, because lease expiry closes the old task and a new task/session is opened for further input. Do not assert full N-08 same-task continuation without more evidence. Do not change Host/gateway or rollback based on this test alone.
