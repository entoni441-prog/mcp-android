// Serves the real gateway /mcp handler over HTTP for an external MCP client.
// OAuth layer is replaced by injected owner props (the OAuth library is tested by its own suite);
// no tunnel registered → simulates the PC being offline.
import http from 'node:http';
import {handleMcp} from '../../src/handlers.mjs';
const kv = new Map();
const env = {NEXUS_TOKEN: 'x'.repeat(43), OAUTH_KV: {get: async k => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v), delete: async k => kv.delete(k)}};
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await handleMcp(new Request('http://gw' + req.url, {method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'DELETE'].includes(req.method) ? undefined : Buffer.concat(chunks)}), env, {props: {owner: true}});
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(Number(process.argv[2] || 8899), '127.0.0.1', () => console.log('ready'));
