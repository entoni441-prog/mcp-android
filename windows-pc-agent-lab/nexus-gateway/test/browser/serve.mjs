// Real-browser harness: gateway /authorize with real GuardCore; fake OAuth provider whose
// redirectUri points to a second origin (stand-in for chatgpt.com). Proves the form POST → 302 works.
import http from 'node:http';
import {handleDefault, sha256hex} from '../../src/handlers.mjs';
import {fakeGuardNamespace} from '../fake-guard.mjs';
const [gwPort, cbPort] = [Number(process.argv[2]), Number(process.argv[3])];
const cb = `http://127.0.0.1:${cbPort}/callback`;
const env = {
  CONSENT_GUARD: fakeGuardNamespace().ns,
  OWNER_PASSPHRASE_SHA256: await sha256hex('browser-test-pass'),
  OAUTH_PROVIDER: {
    parseAuthRequest: async () => ({clientId: 'chatgpt', redirectUri: cb, scope: [], state: 'st'}),
    lookupClient: async () => ({clientName: 'ChatGPT'}),
    completeAuthorization: async () => ({redirectTo: cb + '?code=CODE123&state=st'}),
  },
};
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await handleDefault(new Request(`http://localhost:${gwPort}` + req.url, {method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined}), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(gwPort, '127.0.0.1');
http.createServer((req, res) => { res.writeHead(200, {'content-type': 'text/html'}); res.end('<p id=ok>CALLBACK_REACHED ' + req.url + '</p>'); }).listen(cbPort, '127.0.0.1', () => console.log('ready'));
