# NEXUS recovery lab

Requires Node.js; no dependencies. Run from the repository root:

```powershell
node --test windows-pc-agent-lab/nexus-recovery-lab/worker.test.mjs
node windows-pc-agent-lab/nexus-recovery-lab/worker.mjs C:\Users\krado\Documents\NEXUS\_recovery-e2e-20261106
```

Create the E2E sandbox if absent; it must initially be empty. Tests use only newly created OS temporary directories and remove their own fixtures. Never reset or delete an existing E2E sandbox.

Worker accepts an absolute existing directory as argv[2]. Fixed taskId: `nx-codex-recovery-20261106`. First run exclusively publishes a flushed checkpoint.json atomically using a temporary file and hard link, writes fixed effect-once.txt with wx, prints WORKER_READY with its PID, and waits 90 seconds. Without an external kill it fails, never completes. Worker never kills processes.

The experiment controller must kill only the exact worker it launched after READY, confirm termination, then launch a fresh worker with the same sandbox. Recovery validates checkpoint and fixed effect, preserves both files, writes complete.json with wx, prints RECOVERED_COMPLETE, exits 0. A run after COMPLETE fails closed. Unexpected, partial, malformed or extra state fails without overwriting existing files. Errors never print file contents, paths, environment variables or exception details; tests check fixed output with a private sentinel.

Single controller only; concurrent starts are unsupported. Atomic publication requires a filesystem supporting hard links. File sync protects checkpoint contents; this experiment demonstrates process crash recovery, not power-loss durability or exactly-once delivery to external services. Partial first-run state intentionally needs manual inspection and is not repaired.

Only test-owned child workers may be killed by tests. Do not operate Host, supervisor, cloudflared, Gateway, main, Codex Desktop, user processes, security, power or production. E2E data belongs exclusively in the specified sandbox; repository changes are limited to these three lab files.
