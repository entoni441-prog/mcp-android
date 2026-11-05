# ACTIVATE — NX-03 discovery hotfix, integrated NEXUS 0.6.1e

**Scope:** change only `nexus-host/discover.mjs` of the running Host. This is a one-file hotfix, not an overwrite with the historical unaccepted `0.6.1e` branch.

## Sources and independent gates

- Current production: 0.6.1d + live-accepted NX-13/19/21/26, installed NX-26 code `2f805483e9fef540464a457035b562d1fc678b9d`.
- New integrated branch: `experiment/nexus-nx03-integrated-20261106`, created from accepted checkpoint `fb43ef6`.
- **Immutable code SHA:** `73b487e` (cherry-picked prior `980f458`), only `discover.mjs` and tests.
- CI trigger added in `06a8cbbbe8fbc8a264da0ba184b3ebba026c55c8`. Required CI: [42131836638](https://github.com/entoni441-prog/mcp-android/actions/runs/42131836638), all Windows/Linux/Gateway must be success before install.
- Manifest: `MANIFEST-NX03-0.6.1e-20261106.sha256`.

## Exactly one file, with explicit SHA-256

| File | Installed BEFORE | Target pinned source |
|---|---|---|
| `discover.mjs` | `671fc4956115fc1dd441e1b812b2ce99e8863961994f1a420d7711ef872f9bf8` | `6a4136e0d0d12b8bdedc8a79edb5213c23d2428951e232c32c954e1575b4090d` |

## Preflight and installation

1. Confirm exact old Host/supervisor PID and command lines, existing `NEXUS-Host-Run` task, host health, owner stop flags absent, all installed NX-13/19/21/26 runtime files unchanged.
2. Confirm `discover.mjs` old SHA, new SHA against manifest and immutable commit `73b487e`, CI 3/3 PASS. On mismatch STOP.
3. Make timestamped **single-file backup**, independently verify SHA and byte count.
4. Use autonomous local installer with durable state and rollback. Stop **only** the verified NEXUS Host and supervisor (never `taskkill /t`); atomically replace only `discover.mjs`, compare new SHA, start the existing task, verify new Host/supervisor, local health and Gateway HTTP 200.
5. If Host or supervisor cannot recover or the installed SHA differs, automatically restore the backup and verify recovery. Do not change Gateway, production main, user security or power.
6. **Real acceptance NX-03:** activate live view on phone; `manage_app_access({action:'list'})` should show `chatgpt` with class `agent`. `open_app({app:'chatgpt'})` should return started=true/via=discovered or a precise non-security error; verify the actual ChatGPT window and process without sending any user message. The existing owner ChatGPT window must not be claimed as NEXUS-owned. If app launch fails, record FAIL and avoid retry loops.
7. Finish with verified process/window preservation and exact checkpoint. Do not repeat accepted NX-13/19/21/26.

**Important:** discovering ChatGPT and validating the absolute executable is confirmed read-only on the actual Windows PC. Launch through installed `open_app` is NOT yet confirmed until the live acceptance.
