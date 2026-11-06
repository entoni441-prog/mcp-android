# Experimental bounded Codex CLI recovery

Standalone Node.js 24 ESM supervisor. No dependencies, installation, login,
Desktop automation, services, security changes, or production integration.
This recovers a recorded **CLI session**, not a Codex Desktop GUI thread.

## Run contract

Run `node controller.mjs run <absolute-manifest.json>` from this directory.
The final stdout line is a fixed-schema JSON summary; exit code is 0 only for
COMPLETED. Other outcomes exit 1. No prompts, model text, stderr, environment,
or raw events are logged. `state.json` also provides operator status while running.

Manifest is a JSON object with exactly these required properties:

| Property | Contract |
| --- | --- |
| taskId | String, 1–64 ASCII letters, digits, underscore or hyphen |
| approved | Literal `true`: owner explicitly authorizes this bounded task |
| workingDirectory | Normalized absolute path to an existing Git repository root |
| codexExe | Normalized absolute path to the actual executable; no shell wrapper |
| codexSha256 | Lowercase 64-character SHA-256 digest of that executable |
| expectedBranch | Nonempty exact branch name; checked before every spawn |
| stateDirectory | Normalized absolute path to an existing dedicated directory outside the repo; neither may contain the other |
| initialPrompt | Nonempty string, at most 32768 characters, no NUL |
| resumePrompt | Same bounds; must direct continuation of the recorded task |
| maxResumes | Literal number `1` |
| completionFile | Normalized absolute path inside stateDirectory; existing parent required; cannot be state.json or owner.json |

Create the state directory before execution. Use one dedicated directory for one
task; do not share it with other applications. Paths are resolved through realpath
to reject practical ancestor symlink escapes. Completion file symlinks are rejected.
The Git tree must be clean, with one development exception: untracked files under
`windows-pc-agent-lab/nexus-codex-autoresume/`. Tracked modifications there still stop
the run. Git calls have a 10-second timeout. No Git mutation is performed.

The authorized task must atomically write the following bounded JSON marker to
completionFile only after its work is complete:

```json
{"taskId":"the-manifest-task-id","status":"completed"}
```

Markers must be regular files no larger than 1024 bytes. A matching valid marker
is the completion authority, including after a nonzero exit or malformed event.
Prompts must arrange bounded, idempotent effects and this marker themselves.
The controller cannot validate the semantics of the authorized task.

Initial arguments are exactly:
`exec --json --sandbox workspace-write -C <workingDirectory> <initialPrompt>`.
Resume arguments are exactly:
`exec resume --json <recorded-thread-UUID> <resumePrompt>`.
No bypass flags or approval overrides are used. Existing Codex approval and sandbox
configuration is retained for resume; real CLI compatibility must be verified by
the operator before any real trial. A reported failed turn stops rather than
retrying a possible approval boundary. A completed turn without a valid marker
also stops because its completion is ambiguous.

## State and stop behavior

An exclusive, permanent `owner.json` claim precedes execution. Any later invocation
using the same state directory is rejected, even after supervisor interruption or
with a different taskId. Do not delete claims to retry uncertain work. There is no
automatic supervisor restart/reclaim protocol: inspect the task and child manually.

`state.json` records taskId, attempt (0 or 1), exact locally spawned child PID,
thread UUID, allowlisted turn status, timestamps, status and safe reason code.
Writes use a temporary file, file fsync and atomic rename; directory fsync is
best effort on Windows. State transitions are CREATED → RUNNING → RECOVERING →
COMPLETED or STOP; no-crash runs go directly RUNNING → COMPLETED. Thread IDs are
persisted as they arrive. A thread ID must be a valid UUID and cannot change.
Unknown JSON event fields are discarded, malformed JSON stops recovery, lines are
bounded to 64 KiB, and partial UTF-8/chunks are handled.

Only a locally spawned child's `close` event with nonzero exit or signal qualifies
for recovery. A matching completion marker is checked first. Missing UUID, failed
turn, malformed events, ambiguous successful exit, or exhausted budget causes STOP.
No `--last` guessing. PID is taken from Node's child object, never trusted from events.

Before each spawn and every 50 ms during execution, read-only checks look for
`owner-stop.json` or `host-off` under the current user's `.nexus-host` directory.
Either means STOP. Each child has a five-minute observation deadline. Timeout means
STOP with `TIMEOUT_CHILD_MAY_BE_ALIVE`, no recovery. The supervisor detaches its
pipes and never kills a child, GUI app, or unrelated process. A child may remain
alive after STOP or supervisor failure; the operator must inspect it. These checks
are polling boundaries, not an instantaneous stop or cancellation guarantee.

## Tests and independent mock trial

From the repository root:

```powershell
node --test windows-pc-agent-lab/nexus-codex-autoresume/controller.test.mjs
node --test --test-name-pattern="external exact child PID" windows-pc-agent-lab/nexus-codex-autoresume/controller.test.mjs
```

The second command is a separately selectable scenario: it spawns a supervisor
process, waits for checkpoint READY, verifies its recorded child PID against the
checkpoint PID, externally kills that exact mock child, and observes automatic
resume with the exact UUID and a single effect. It never kills a discovered
production process. Fixtures use isolated OS temp directories and temporary Git
repositories without commits. Cleanup may kill only those spawned test processes.

`fake-codex.mjs` accepts `exec --json ...` and `exec resume --json UUID ...` when
launched through Node. It reads test-only `mock.json` from its working directory
(taskId, stateDirectory, mode), writes effect-once.txt and checkpoint.json on the
first run, then holds in mode `hold`. After that process is killed, the resumed
invocation writes resumed.json and complete.json without repeating the effect.
Other modes exercise error boundaries. Fixed thread UUID:
`12345678-1234-4234-8234-123456789abc`.

The exported `runManifest` accepts test-only options `testScript`, `ownerDirectory`
and `timeoutMs`; they are unavailable in the manifest/CLI. Tests use Node's own
hashed executable plus the mock script, never real Codex or owner environment.

## Limits

This is an experimental single-task supervisor. It does not prove production Codex
resume behavior or exactly-once arbitrary external side effects. Only the mock's
single effect is verified. Real Codex, Host and Gateway are never launched by tests.
The manifest approves a task but is not an authentication or hostile-user boundary.
Trusted executable, repository, state directory, prompts and local filesystem are
required; concurrent hostile path/binary substitution is not prevented. Hash checks
precede each spawn but cannot eliminate executable replacement races. Supervisors
using different state directories cannot coordinate a global singleton; operators
must launch only one task. Unbounded or approval-requiring work must stop for owner
handling. No installation, login, commit, push, or production trial is included.
