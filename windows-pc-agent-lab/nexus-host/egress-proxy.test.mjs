// Egress proxy: address policy + real HTTP/CONNECT through the proxy (no browser, no internet needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {createEgressProxy, isPublicIp} from './egress-proxy.mjs';

test('isPublicIp: private, loopback, link-local, CGNAT, mapped, NAT64, Teredo, 6to4 are not public', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.215.14', '2606:4700::1111', '2a00:1450:4001::64']) assert.ok(isPublicIp(ip), ip);
  for (const ip of ['127.0.0.1', '127.8.8.8', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254', '100.64.0.1', '100.127.1.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '192.0.2.1', '198.18.0.1', '::', '::1', 'fd00::1', 'fc12::1', 'fe80::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:192.168.1.1', '64:ff9b::7f00:1', '2001:db8::1', '2002:7f00:1::', '2001:0:4136:e378::1', 'not-an-ip']) assert.equal(isPublicIp(ip), false, ip);
  assert.equal(isPublicIp('::ffff:8.8.8.8'), true);
});

// Fake DNS: names the tests control.
const DNS = {'public.test': ['127.0.0.2'], 'rebind.test': ['127.0.0.1'], 'mixed.test': ['127.0.0.2', '10.0.0.1'], 'v6local.test': ['::1'], 'meta.test': ['169.254.169.254']};
const lookup = (h, o, cb) => DNS[h] ? cb(null, DNS[h].map(address => ({address, family: net.isIPv6(address) ? 6 : 4}))) : cb(Object.assign(Error('ENOTFOUND'), {code: 'ENOTFOUND'}));

async function setup(ports) {
  let hits = 0;
  const site = http.createServer((req, res) => { hits++; res.end('site:' + req.headers.host + req.url); });
  await new Promise(r => site.listen(0, '127.0.0.2', r));
  const port = site.address().port;
  const proxy = createEgressProxy({lookup, ports: ports || [port, 443], isPublic: ip => ip === '127.0.0.2'});
  const pport = await proxy.listen();
  return {port, pport, proxy, site, hits: () => hits};
}
const viaProxy = (pport, url) => new Promise((res, rej) => {
  const r = http.request({host: '127.0.0.1', port: pport, method: 'GET', path: url, headers: {host: new URL(url).host}}, x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res({status: x.statusCode, body: b})); });
  r.on('error', rej); r.end();
});
const connect = (pport, target) => new Promise((res, rej) => {
  const s = net.connect(pport, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
  let b = ''; s.on('data', c => { b += c; if (b.includes('\r\n\r\n')) { s.destroy(); res(b.split('\r\n')[0]); } });
  s.on('error', rej); s.on('end', () => res(b.split('\r\n')[0]));
});

test('HTTP through proxy: allowed name reaches the checked IP with the original Host header', async () => {
  const t = await setup();
  try {
    const r = await viaProxy(t.pport, `http://public.test:${t.port}/a?b=1`);
    assert.equal(r.status, 200);
    assert.equal(r.body, `site:public.test:${t.port}/a?b=1`);
  } finally { t.proxy.close(); t.site.close(); }
});

test('HTTP through proxy: names resolving to private/loopback/metadata, mixed answers, literal IPs, bad ports → 403, upstream never hit', async () => {
  const t = await setup();
  try {
    for (const host of ['rebind.test', 'mixed.test', 'v6local.test', 'meta.test', 'localhost', 'x.localhost', '127.0.0.1', '10.0.0.1', '[::1]', 'nx.test']) {
      const r = await viaProxy(t.pport, `http://${host}:${t.port}/secret`);
      assert.equal(r.status, 403, host);
      assert.match(r.body, /^nexus_egress_denied/, host);
    }
    assert.equal((await viaProxy(t.pport, 'http://public.test:22/')).status, 403);
    assert.equal(t.hits(), 0);
    assert.ok(t.proxy.stats.denied >= 11);
  } finally { t.proxy.close(); t.site.close(); }
});

test('CONNECT (HTTPS/WSS): private destinations and ports refused, public name tunnelled', async () => {
  const t = await setup();
  try {
    for (const target of ['rebind.test:443', 'mixed.test:443', '127.0.0.1:443', '[::1]:443', '192.168.1.1:443', 'localhost:443', 'public.test:22', 'garbage']) {
      assert.match(await connect(t.pport, target), /^HTTP\/1\.1 (403|400)/, target);
    }
    assert.match(await connect(t.pport, `public.test:${t.port}`), /^HTTP\/1\.1 200/);
  } finally { t.proxy.close(); t.site.close(); }
});

test('production defaults: no injection → every private destination refused even for HTTP to 127.0.0.1', async () => {
  const proxy = createEgressProxy();
  const pport = await proxy.listen();
  try {
    assert.equal((await viaProxy(pport, `http://127.0.0.1:80/`)).status, 403);
    assert.equal((await viaProxy(pport, `http://localhost:443/`)).status, 403);
    assert.match(await connect(pport, '169.254.169.254:443'), /403/);
  } finally { proxy.close(); }
});

// 0.5.2 (Windows CI 41479530163): a CONNECT tunnel must not outlive its browser side, and close() must end every tunnel —
// otherwise upstream sockets keep the Host process alive after the NEXUS browser was killed.
test('CONNECT tunnel: client reset destroys upstream; close() ends all open tunnels', async () => {
  const net = await import('node:net');
  const upstreamClosed = [];
  const up = net.createServer(s => { s.on('close', () => upstreamClosed.push(Date.now())); s.on('error', () => {}); });
  await new Promise(r => up.listen(0, '127.0.0.2', r));
  const port = up.address().port;
  const proxy = createEgressProxy({lookup: (h, o, cb) => cb(null, [{address: '127.0.0.2', family: 4}]), ports: [port], isPublic: ip => ip === '127.0.0.2'});
  const pport = await proxy.listen();
  const open = () => new Promise((res, rej) => {
    const c = net.connect(pport, '127.0.0.1', () => c.write(`CONNECT example.com:${port} HTTP/1.1\r\nHost: example.com:${port}\r\n\r\n`));
    c.once('data', d => (/200/.test(String(d)) ? res(c) : rej(Error(String(d)))));
    c.on('error', () => {});
  });
  const c1 = await open();
  assert.equal(proxy.openTunnels(), 2);
  c1.resetAndDestroy();
  for (let i = 0; i < 50 && upstreamClosed.length < 1; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(upstreamClosed.length, 1, 'upstream closed after the browser side was reset');
  assert.equal(proxy.openTunnels(), 0);
  const c2 = await open();
  assert.equal(proxy.openTunnels(), 2);
  proxy.close();
  for (let i = 0; i < 50 && upstreamClosed.length < 2; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(upstreamClosed.length, 2, 'close() tears down the remaining tunnel');
  assert.equal(proxy.openTunnels(), 0);
  c2.destroy(); up.close();
});
