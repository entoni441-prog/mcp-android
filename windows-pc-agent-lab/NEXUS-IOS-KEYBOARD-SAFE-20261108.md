# NEXUS Live iPhone keyboard — narrow safe UX patch (2026-11-08)

## User need / verified cause
Owner tapped Chrome Remote Desktop PIN/password setup fields in inline NEXUS Live on an iPhone; the native iOS keyboard did not open. Desired UX: tapping a text field on the Live screen should bring up the iPhone's native keyboard.

Existing Live v11 architecture deliberately validates a Host `mouse_action` response first:
```js
editable = target.isPassword === false && /Edit|Document|ComboBox/.test(target.control)
```
Only after its awaited RPC does `showComposer()` call `input.focus()`. Mobile Safari may not open the software keyboard outside a direct owner gesture (RPC + 340 ms gesture delay has already lost activation). Password and PIN fields are **purposefully excluded** by `isPassword` and control-label checks. Sending a Google CRD PIN using model-visible MCP `keyboard_action({text})`, chat, logs or the clipboard is **not acceptable**.

## Experimental fix
Branch `experiment/nexus-ios-keyboard-safe-20261108` (off `experiment/nexus-consent-visibility-remote-20261108`). Only two source files changed:
- Gateway `src/widget.mjs`: generalize keyboard labels to iOS/Android; leave secure-input refusal active; after a verified ordinary editable field, expose a local **⌨** button which directly calls `HTMLInputElement.focus` in the synchronous owner click event, no second model tool call. Clear explanatory error for PIN/password rather than falsely implying the keyboard malfunctioned. `touch-open` never sends model or Host input itself.
- `test/widget-samsung-ime.test.mjs`: regression for iPhone direct user-gesture focus and no extra RPC, plus tests that a simulated PIN field cannot open the ordinary text channel or send secret characters.

## Verification
On owner's Windows, using ONLY isolated clone `C:\Users\krado\NEXUS-workspace\nexus-ios-keyboard-test-20261108`:
- Targeted 30/30 Node widget tests **PASS**.
- Full Gateway 91/91 Node tests **PASS**.
- This is **not** a physical iPhone Safari acceptance test. The direct user click is tested in a JS widget harness; actual iOS keyboard opening requires owner verification after an appropriately reviewed deployment.
- Did not modify deployed Cloudflare Gateway, active Host, Live v11, protected Windows settings, credentials, owner account or production/main. No reboot, no browser navigation.
- Explicit one-click keyboard opening on the **first** tap of an arbitrary screenshot is still **not** guaranteed: identifying the remote target requires an async, Host-authoritative reply. Pre-focusing an arbitrary editable control before confirming it is not a credential field would cause unexpected keyboard opening and potential secret ingestion. Do not misrepresent fallback as automatic first-tap solution.

## Secure PIN activation — immediate route
User was previously physically at the Windows PC. The Google CRD onboarding screen is at **'Выберите PIN-код'**; PC name `Antoni-ChatGPT` was selected, Google login and signed Host installation confirmed. First enrollment PIN is a genuine secret. User must enter it **on the real Windows keyboard** or through an independently verified direct-to-owner secure remote-input channel that does not cross ChatGPT/MCP. Never request the PIN in chat or relay it with generic `keyboard_action`. After pressing `Запуск`, ChatGPT may read-only verify the Host service is running, Google device enrollment appears, and owner connects from their Android or iPhone CRD client. Only after independently verified remote pre-logon access and preservation of unsaved Notepad can a controlled reboot be attempted.

## Long-term architecture
A true single-tap, owner-only secret-input experience requires a separately authenticated, rate-limited encrypted input channel from an owner-operated mobile input surface directly to an allowlisted Host input target. It must pin target HWND/control identity and `isPassword` before sending, hide all bytes from model-facing tools, audit only metadata (never plaintext), avoid clipboard/logs, and test consent, CSRF, replay, field switch, STOP, and phone/browser sandbox boundaries. Separate security review required. **Do not install a generic privileged broker or weaken UAC to achieve it.**

## Release gate
Not deployed. Existing Live v11 is a critical independent access channel; local Gateway project has been confirmed older than deployed Worker. Before any production update, obtain a byte-for-byte rollback image of the real Worker and compare its exact bundle to current branch. Build and deploy only a reviewed narrow patch with owner authorization for protected operations. Do not treat the old local gateway folder as current. This narrow patch improves regular text UX but does not solve PIN input through Live.
