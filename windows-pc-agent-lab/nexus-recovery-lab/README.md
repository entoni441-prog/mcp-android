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

## Stage 2: isolated TCP retry

```powershell
node --test windows-pc-agent-lab/nexus-recovery-lab/transport.test.mjs
node windows-pc-agent-lab/nexus-recovery-lab/transport.mjs
```

No packages, worker runs, files or external services are involved. Each invocation binds a fresh Node net server only to 127.0.0.1, port 0. The client sends a synthetic command with fixed taskId and idempotencyKey. The server commits one in-memory effect and destroys the first accepted socket BEFORE ACK. The client detects EOF/error, opens one new connection and retries the identical serialized command at most once. The server deduplicates the key and ACKs without another effect. Invalid client keys fail closed before transmission. The no-reconnect negative control confirms the unknown outcome is not reported as success.

The report contains only status, connectionCount, forcedDrops, committedEffects, retryCount, originalId and ack. No payload, synthetic secret, socket address or raw error is printed. Each request has a 1-second timeout; the run has a 5-second deadline. Finally blocks destroy owned sockets and close the owned server. Tests have deadlines below 15 seconds.

This is a real loopback TCP drop/retry test, NOT a real Cloudflare disconnection. Deduplication exists only in this server's memory during one run; it makes no claim about durable remote effects, server restart recovery or production transport behavior. Stage 2 adds only transport.mjs, transport.test.mjs and this README section; existing worker files are unchanged.
