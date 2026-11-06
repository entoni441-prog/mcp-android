import net from 'node:net';
import { pathToFileURL } from 'node:url';

const TASK = 'nx-codex-recovery-20261106';
const KEY = 'nx-codex-transport-once-20261106';
const COMMAND = Object.freeze({ taskId: TASK, idempotencyKey: KEY, action: 'synthetic-effect' });
const LIMIT = 2048;

// One bounded request on one new TCP connection. Never logs peer data/errors.
function request(port, wire, clients) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    clients.add(socket);
    let settled = false, buffer = '';
    const finish = ack => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ack);
    };
    const timer = setTimeout(() => finish(false), 1000);
    socket.on('error', () => finish(false));
    socket.on('end', () => finish(false));
    socket.on('close', () => { clients.delete(socket); finish(false); });
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (buffer.length > LIMIT) return finish(false);
      if (!buffer.includes('\n')) return;
      finish(buffer === JSON.stringify({ taskId: TASK, idempotencyKey: KEY, ack: true }) + '\n');
    });
    socket.connect({ host: '127.0.0.1', port }, () => socket.write(wire));
  });
}

export async function runTransport({ reconnect = true, key = KEY, syntheticSecret = 'SYNTHETIC_PRIVATE_SENTINEL' } = {}) {
  let connectionCount = 0, forcedDrops = 0, committedEffects = 0, retryCount = 0, ack = false;
  let unchanged = true;
  const clients = new Set(), peers = new Set(), committed = new Set();
  const command = { ...COMMAND, idempotencyKey: key, syntheticSecret };
  const wire = JSON.stringify(command) + '\n';
  const valid = key === KEY;
  const server = net.createServer(socket => {
    peers.add(socket);
    connectionCount++;
    socket.on('close', () => peers.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(1000, () => socket.destroy());
    let buffer = '', handled = false;
    socket.on('data', chunk => {
      if (handled) return socket.destroy();
      buffer += chunk.toString('utf8');
      if (buffer.length > LIMIT) return socket.destroy();
      if (!buffer.includes('\n')) return;
      handled = true;
      let received;
      try { received = JSON.parse(buffer); } catch { return socket.destroy(); }
      if (received.taskId !== TASK || received.idempotencyKey !== KEY || received.action !== COMMAND.action || buffer !== wire) return socket.destroy();
      unchanged &&= received.taskId === command.taskId && received.idempotencyKey === command.idempotencyKey;
      if (!committed.has(received.idempotencyKey)) {
        committed.add(received.idempotencyKey);
        committedEffects++;
        forcedDrops++;
        socket.destroy(); // Real transport loss AFTER commit, BEFORE any ACK.
        return;
      }
      socket.end(JSON.stringify({ taskId: TASK, idempotencyKey: KEY, ack: true }) + '\n');
    });
  });
  // Also consume unexpected server errors after listening; never print raw errors.
  server.on('error', () => {});
  const deadline = setTimeout(() => {
    for (const socket of [...clients, ...peers]) socket.destroy();
    server.close();
  }, 5000);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: 0 }, resolve);
    });
    const port = server.address().port;
    // Invalid local input fails closed before connecting or sending anything.
    if (valid && wire.length <= LIMIT) {
      ack = await request(port, wire, clients);
      if (!ack && reconnect) {
        retryCount = 1;
        ack = await request(port, wire, clients); // Exactly the same serialized command.
      }
    }
  } catch { /* Report only fixed fields below. */ }
  finally {
    clearTimeout(deadline);
    for (const socket of [...clients, ...peers]) socket.destroy();
    await new Promise(resolve => server.close(() => resolve()));
  }
  const pass = ack && unchanged && connectionCount === 2 && forcedDrops === 1 && committedEffects === 1 && retryCount === 1;
  return { status: pass ? 'PASS' : 'FAIL', connectionCount, forcedDrops, committedEffects, retryCount, originalId: unchanged ? 'unchanged' : 'changed', ack };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await runTransport();
    console.log(JSON.stringify(report));
    process.exitCode = report.status === 'PASS' ? 0 : 1;
  } catch {
    console.log(JSON.stringify({ status: 'FAIL', connectionCount: 0, forcedDrops: 0, committedEffects: 0, retryCount: 0, originalId: 'unchanged', ack: false }));
    process.exitCode = 1;
  }
}
