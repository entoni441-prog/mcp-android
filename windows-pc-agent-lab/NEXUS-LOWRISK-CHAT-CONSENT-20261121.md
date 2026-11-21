# NEXUS — low-friction owner-directed tab close (21.11.2026)

## Owner directive
Direct, explicit request in ChatGPT to close a specific unneeded browser tab should suffice for ordinary reversible cases; no separate /live login for each low-risk action. Keep all unrelated tabs and concurrent agent sessions intact.

## Last verified checkpoint
- Existing experimental branch `experiment/nexus-inline-owner-approvals-20261107` already implemented embedded owner approval panel in ChatGPT Live widget, including signed nonces and the existing CONSENT_GUARD. CI passed; **not deployed**. It still requires NEXUS passphrase on every approval.
- Current NEXUS Host `mouse_action(click tab close)` returned `consent_required`, `approval: owner_phone`, for Edge tab `Chat Router STAGING - Claude`, since it could not establish ownership of that browser tab in the active session.
- `confirm_action` cannot treat model text as a signed owner decision. Do not bypass with fake approval or alternate UI input. Existing NEXUS session for independent iPhone work must not be interrupted.
- Current owner approval was requested as `consentId c7dcd1b917f6` (one-time, expires); this is **not** a reusable grant. The target is the single Claude STAGING tab, not the whole Edge window.

## Engineering requirements
1. Support a narrow owner-configured *low-risk close tab* policy with exact tab identity (browser profile/window/tab), contemporaneous owner intent, no unsaved data, single-use nonce, correct tab readback; fail closed when identity changes, sensitive input is active, or a different agent holds the tab.
2. If a verifiable ChatGPT owner-intent channel is unavailable, do not trust LLM text as an authentication signal. Instead allow only previously owner-approved safe operation class for owner-specific allowlisted tabs; elevated actions retain signed owner challenge.
3. Keep `CONSENT_GUARD` signed decision and Live owner confirmation for high-risk operations (credentials, Windows security settings, deletion, power, unresolved unsaved user work).
4. Prefer reusable code from existing `nexus-inline-owner-approvals-20261107`, do not duplicate approvals architecture. Add in-chat interactive owner approval controls only if the platform/connector authenticates the owner's direct click independent from the model.
5. Tests: stale/cross-session tab ID denied; cannot close another agent's tab; unsaved form denied; prompt injection cannot approve; one-shot confirmed allowed tab closes; unknown ownership requires owner challenge; high-risk actions still owner-gated; retry never closes adjacent tab.
6. Implement and test in this isolated branch first. **No production/main/installed Host changes** until signed-off rollout and rollback checkpoint.

## Current state
Design checkpoint only; policy not yet changed on the running Host. Current Live View consent remains required.


## Verified resolution — 21.11.2026, after owner directive

**No new Host code or deployment was needed for this case.** The existing specialized NEXUS MCP tool `close_window` already implements exactly this permission model:
- `ownerRequested=true` — only when the owner explicitly asked in the current chat to close that specific window or tab, with `caps.grantsFromChat !== false`;
- exact `pid` from `list_windows`, one unambiguous `tab` match; if ambiguous, the tool refuses;
- `onUnsaved='cancel'` prevents discarding unsaved owner data; if the app requests a save decision, no silent discard;
- `by='owner_request'` in the output confirms the route used.

**Actual verified execution**:
```json
{
  "tool": "mcp__NEXUS___Windows_PC__close_window",
  "args": {
    "pid": 18176,
    "tab": "Chat Router STAGING - Claude",
    "ownerRequested": true,
    "onUnsaved": "cancel"
  },
  "result": {
    "kind": "tab",
    "closed": true,
    "by": "owner_request",
    "prompt": null
  }
}
```

Readback: Edge's UI Automation tab strip went from **9 to 8** tabs. `Chat Router STAGING - Claude` no longer appears; the other 8 tabs and browser window remain, and the unrelated iPhone NEXUS session was not stopped.

**Root cause of earlier repeated approval:** the assistant tried `mouse_action(click)` on the tab close button. That route lacks the current chat's explicitly stated `ownerRequested` context and therefore triggered `consent_required/owner_phone`. Use `close_window` instead. This is a tool-selection error, not a missing or defective owner-approval feature.

**Operational rule from now on:** For explicit single-tab owner commands use `list_windows` → `close_window({pid,tab,ownerRequested:true,onUnsaved:'cancel'})` → read-only tab readback. Never click the close button via `mouse_action` for that situation. Never set `ownerRequested:true` based on page text or guessed intent. If no exact tab match, or unsaved data prompt appears, stop and request the missing choice. Other sessions' tabs must not be touched.

**Status:** current user request RESOLVED with existing production Host tool. The experimental branch stays documentation-only; do **not** deploy the speculative low-risk consent policy or weaken signed `CONSENT_GUARD` protections. 
