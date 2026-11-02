/**
 * NEXUS Host 0.4.0 — egress proxy for the NEXUS browser (network-level SSRF / DNS-rebinding protection).
 *
 * Edge is started with --proxy-server=<this proxy> and --proxy-bypass-list=<-loopback>, so EVERY request —
 * top-level navigations, every redirect hop, subresources, fetch/XHR, WebSocket — goes through here, and
 * Edge itself never resolves DNS. This proxy resolves the name ONCE, refuses if ANY resolved address is
 * non-public, and then connects to exactly that checked IP (no second lookup → rebinding impossible).
 * Plain HTTP is forwarded; HTTPS/WSS use CONNECT (end-to-end TLS, the proxy never sees content).
 * Listens on 127.0.0.1 only. Zero npm dependencies.
 */
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns';

export const DEFAULT_PORTS = Object.freeze([80, 443, 8080, 8443]);

/** true only for globally routable unicast addresses. */
export function isPublicIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;            // this-net, private, loopback, multicast/reserved
    if (a === 100 && b >= 64 && b <= 127) return false;                         // CGNAT (Tailscale etc.)
    if (a === 169 && b === 254) return false;                                   // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;             // IETF / TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return false;                      // benchmarking
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (net.isIPv6(ip)) {
    const h = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (mapped) return isPublicIp(mapped[1]);
    if (h === '::' || h === '::1') return false;
    if (/^(fc|fd)/.test(h) || /^fe[89ab]/.test(h) || /^ff/.test(h)) return false; // ULA, link-local, multicast
    if (h.startsWith('64:ff9b:') || h.startsWith('2001:db8') || h.startsWith('2002:')) return false; // NAT64, docs, 6to4 (embeds IPv4)
    if (/^2001:0{0,3}:/.test(h)) return false;                                   // Teredo (embeds IPv4)
    return /^[23]/.test(h);                                                      // global unicast only
  }
  return false;
}

const HOP = ['proxy-connection', 'proxy-authorization', 'connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

/**
 * @param {object} o
 * @param {boolean} [o.allowPrivate]  TEST ONLY — not reachable from capabilities.json or MCP arguments.
 * @param {Function} [o.lookup]       dns.lookup-compatible (tests inject names).
 * @param {number[]} [o.ports]        allowed destination ports.
 * @param {Function} [o.isPublic]     TEST ONLY — address policy override (default isPublicIp).
 */
export function createEgressProxy({allowPrivate = false, lookup = dns.lookup, ports = DEFAULT_PORTS, isPublic = isPublicIp} = {}) {
  const stats = {allowed: 0, denied: 0, deniedHosts: []};
  const deny = (host, why) => { stats.denied++; if (stats.deniedHosts.length < 50) stats.deniedHosts.push(`${host} ${why}`); };

  /** Resolve once; every address must be public; returns the single IP we will connect to. */
  async function resolveChecked(host, port) {
    if (!ports.includes(port)) return {error: 'port_not_allowed'};
    const h = host.replace(/^\[|\]$/g, '').toLowerCase();
    if (!h || h.length > 253) return {error: 'bad_host'};
    let addrs;
    if (net.isIP(h)) addrs = [{address: h}];
    else {
      if (h === 'localhost' || h.endsWith('.localhost')) return {error: 'private_destination'};
      try { addrs = await new Promise((res, rej) => lookup(h, {all: true, verbatim: true}, (e, a) => e ? rej(e) : res(a))); }
      catch { return {error: 'dns_failed'}; }
    }
    if (!addrs.length) return {error: 'dns_failed'};
    if (!allowPrivate && !addrs.every(a => isPublic(a.address))) return {error: 'private_destination'};
    return {ip: addrs[0].address};
  }

  const server = http.createServer(async (req, res) => {
    // Plain HTTP: absolute-form request URI.
    let u; try { u = new URL(req.url); } catch { res.writeHead(400); return res.end('nexus_egress_bad_request'); }
    if (u.protocol !== 'http:') { res.writeHead(400); return res.end('nexus_egress_bad_request'); }
    const port = Number(u.port || 80);
    const r = await resolveChecked(u.hostname, port);
    if (r.error) { deny(u.hostname, r.error); res.writeHead(403, {'content-type': 'text/plain'}); return res.end('nexus_egress_denied: ' + r.error); }
    stats.allowed++;
    const headers = {...req.headers}; for (const k of HOP) delete headers[k];
    headers.host = u.host;
    const up = http.request({host: r.ip, port, method: req.method, path: u.pathname + u.search, headers, setHost: false}, ur => {
      const h = {...ur.headers}; for (const k of HOP) delete h[k];
      res.writeHead(ur.statusCode, ur.statusMessage, h); ur.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('nexus_egress_upstream_failed'); });
    req.pipe(up);
  });

  // HTTPS / WSS: CONNECT host:port → raw TCP tunnel to the checked IP.
  // 0.5.2: every tunnel socket is tracked and torn down in pairs. Windows CI 41479530163: after the NEXUS Edge was
  // killed, upstream TCP connections of its CONNECT tunnels stayed open (pipe does not destroy the other side on
  // error/reset) and close() only stopped listening — the process could not exit for minutes or at all.
  const tunnels = new Set();
  const pair = (a, b) => {
    tunnels.add(a); tunnels.add(b);
    const kill = () => { a.destroy(); b.destroy(); tunnels.delete(a); tunnels.delete(b); };
    for (const s of [a, b]) { s.once('close', kill); s.once('error', kill); }
  };
  server.on('connect', async (req, client, head) => {
    const m = /^(\[[0-9a-fA-F:.]+\]|[^:\s]+):(\d{1,5})$/.exec(req.url || '');
    client.on('error', () => {});
    if (!m) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    const host = m[1], port = Number(m[2]);
    const r = await resolveChecked(host, port);
    if (r.error) { deny(host, r.error); client.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\nnexus_egress_denied: ${r.error}`); return; }
    stats.allowed++;
    if (client.destroyed) return;
    const up = net.connect({host: r.ip, port}, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) up.write(head);
      up.pipe(client); client.pipe(up);
    });
    up.on('error', () => { if (client.writable) client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
    pair(client, up);
  });
  server.on('clientError', (e, s) => s.destroy());

  return {
    stats,
    listen: () => new Promise(res => server.listen(0, '127.0.0.1', () => res(server.address().port))),
    close: () => { server.close(); server.closeAllConnections?.(); for (const s of tunnels) s.destroy(); tunnels.clear(); },
    openTunnels: () => tunnels.size,
    resolveChecked,
  };
}
