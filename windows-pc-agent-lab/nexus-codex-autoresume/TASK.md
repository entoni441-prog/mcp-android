# Codex Task Auto-Resume — experimental implementation (2026-11-06)

## Fixed constraints
- Repo: entoni441-prog/mcp-android. Only modify or create files in `windows-pc-agent-lab/nexus-codex-autoresume/`, except for running untracked ephemeral tests in OS temp directories.
- Branch: `experiment/nexus-codex-task-autoresume-20261106`; base e553559. Before editing verify branch and no unrelated changes; TASK.md is expected.
- Owner requested an autonomous Codex crash-resume prototype. NEVER touch installed NEXUS Host, production Gateway, main, cloudflared, Windows security settings, power, secrets, accounts, other apps or subscriptions.
- **Do not use --yolo, --dangerously-bypass-approvals-and-sandbox, --approve-for-me, --ignore-rules, --ignore-user-config, nor modify approvals**. Do not make Git commit/push (operator will audit and do it).
- Codex CLI is already bundled in Windows Codex Desktop package (0.166.0-alpha.6), and `codex login status` returned "Logged in using ChatGPT". Do NOT reinstall or log in.

## Precise outcome
Develop a standalone **experimental** Node 24 ESM supervisor that can run an explicitly authorized bounded Codex CLI task and automatically resume its *recorded CLI session* **once** after a verified child process crash. This is an alternative headless recovery path, NOT an unsupported claim that the GUI Desktop thread itself resumes. GUI can stay closed. Only one task at a time.

Provide:
1. `controller.mjs` with CLI `node controller.mjs run <manifest.json>`; manifest contract described in README.
2. `controller.test.mjs` using Node's built-in node:test and only isolated temporary dirs / fake Codex binary processes (Node scripts); tests may kill only child processes that they spawn and verify by exact child PID. No production effects.
3. `fake-codex.mjs` deterministic mock implementing `exec --json ...` and `exec resume --json THREAD_ID ...`. It must write `checkpoint.json` and `effect-once.txt` in test sandbox before holding on initial run, emit a line `thread.started` with a fixed valid UUID, and after being killed on resume write `complete.json` without touching `effect-once.txt`.
4. `README.md` with precise manifest schema, test instructions, safety, and scope/limitations.
5. Optional `sample-manifest.json` only if it has no user-specific paths/credentials and is clearly non-executable.
Do not change existing files outside this directory.

## Controller invariants
- An explicit manifest with `taskId`, `approved:true`, `workingDirectory`, `codexExe` (absolute), `codexSha256`, `expectedBranch`, `stateDirectory`, `initialPrompt`, `resumePrompt`, and `maxResumes:1`, `completionFile` (absolute inside stateDirectory). Validate all strictly. `stateDirectory` is outside the repo; guard against path traversals/overlaps where practical.
- For real Codex, args `exec --json --sandbox workspace-write -C <workingDirectory> <initialPrompt>`; resume `exec resume --json <EXACT recorded thread UUID> <resumePrompt>`. Keep existing sandbox and approvals; never pass dangerous bypass flags. Use `--json` events, parse only allowlisted fields (thread ID, turn status, process pid), never log full model messages, tool text, prompts or environment.
- Before spawn, enforce `git branch --show-current == expectedBranch`, `git status --porcelain` empty EXCEPT for the newly created module during development (tests can use fresh isolated fake Git repos). Do not perform `git reset`, `clean`, merges or pushes.
- Durable state machine: `CREATED -> RUNNING -> RECOVERING -> COMPLETED` or `STOP`. Persist state atomically with fsync where possible; store taskId, attempt, exact child PID, thread UUID, recorded status, timestamps, and safe reason codes. On crash, if thread ID absent, STOP (do not guess `--last`). If completion is ambiguous, inspect `completionFile` first; if valid marker matches taskId, mark complete without retry. Never retry twice. Never execute a task twice merely due to lost ACK. Reject re-run once terminal. Reject second owner manifest with same taskId in same stateDir.
- Owner-stop, owner pause, explicit permission boundaries: if `%USERPROFILE%\.nexus-host\owner-stop.json` or `host-off` exists at any step, STOP without spawning/resuming; make this path configurable in tests so tests do not rely on owner environment. For real, default can check these read-only.
- Process death must be verified; no hanging forever: bounded timeouts, timeout -> STOP (do not kill unrelated process). Never close or kill arbitrary GUI apps. The supervisor never kills a process itself except its *own* created test child in cleanup if tests expressly need it. Real user operations may require approvals and should stop rather than bypass.
- Secret sanitation: fixed schema summary only, do not write full Codex JSONL, stderr, prompt, tokens. Handle malformed data safely. Child stdout parsing handles partial chunks.
- Test cases: successful no-crash run; real child kill after READY/checkpoint -> same thread exact UUID auto-resume -> one effect; missing thread -> STOP; max-resume exhausted -> STOP; valid completion marker during unknown outcome -> no duplicate; malformed manifest, modified CLI hash, wrong branch, owner STOP, bad JSON events; canary secret does not appear in persisted output.
- Expose minimal `status` or a safe JSON output for NEXUS operator.
- No app installation, no production mutation, no changes to permissions.

## Acceptance
- `node --test windows-pc-agent-lab/nexus-codex-autoresume/controller.test.mjs`: all PASS.
- Separate isolated mock scenario with external kill PID and actual automatic resume by controller after the kill. The operator will execute this test independently (do not claim production Codex auto-resume without a real CLI trial).
- If possible, later a real CLI crash trial against an isolated test-only prompt and state directory will be run by the operator.
- Report exact files, tests and limitations. Don't commit/push.
