/**
 * Consent guard logic, run inside ONE Durable Object instance ("owner").
 * A DO processes calls one at a time and its storage writes in a method are atomic,
 * so lockout check + single-use nonce + passphrase check + counter update cannot race.
 * Replaces the KV counter (KV is eventually consistent, ~1 write/s per key, no atomic increment).
 * `storage` = DurableObjectStorage-like: async get/put/delete(key).
 * Only storage awaits happen inside a method (input gates hold other calls); the passphrase
 * is hashed by the caller BEFORE the call, so no non-storage await can interleave requests.
 */
export const MAX_FAILS = 5;
export const LOCK_MS = 15 * 60_000;
export const CONSENT_TTL_MS = 5 * 60_000;
export const MAX_PENDING = 20;

const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
function eqHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export class GuardCore {
  constructor(storage, now = () => Date.now()) { this.s = storage; this.now = now; }

  async #pending(bucket = 'pending') {
    const t = this.now();
    const all = (await this.s.get(bucket)) || {};
    for (const [k, v] of Object.entries(all)) if (t - v.issuedAt > CONSENT_TTL_MS) delete all[k];
    return all;
  }

  /** Stores the parsed OAuth request under a fresh single-use nonce. */
  async issue(auth) { return this.#issueBucket(auth, 'pending'); }
  /** Isolated widget queue: public widget challenge traffic cannot evict OAuth/login nonces. */
  async issueWidget(auth) {
    if (auth?.kind !== 'widget_owner') throw Error('widget_kind_required');
    return this.#issueBucket(auth, 'widget_pending');
  }
  async #issueBucket(auth, bucket) {
    const pending = await this.#pending(bucket);
    const keys = Object.keys(pending);
    if (keys.length >= MAX_PENDING) delete pending[keys.sort((a, b) => pending[a].issuedAt - pending[b].issuedAt)[0]];
    const b = new Uint8Array(32); crypto.getRandomValues(b);
    const nonce = hex(b);
    pending[nonce] = {auth, issuedAt: this.now()};
    await this.s.put(bucket, pending);
    return nonce;
  }

  /**
   * One atomic decision. Returns {status:'ok', auth} | {status:'locked'|'invalid'|'denied'|'bad_passphrase', ...}.
   * The nonce is burned on every outcome except 'locked' and 'invalid'.
   */
  async attempt(args) { return this.#attemptBucket(args, 'pending'); }
  /** Same atomic passphrase lockout and nonce semantics, separate widget nonce bucket. */
  async attemptWidget(args) { return this.#attemptBucket(args, 'widget_pending'); }
  async #attemptBucket({nonce, passphraseSha256, approve, expectedSha256}, bucket) {
    const t = this.now();
    const lock = (await this.s.get('lock')) || {fails: 0, until: 0};
    if (lock.until > t) return {status: 'locked', retryAfterMs: lock.until - t};
    if (lock.until && lock.until <= t) { lock.fails = 0; lock.until = 0; }
    const pending = await this.#pending(bucket);
    const rec = typeof nonce === 'string' ? pending[nonce] : undefined;
    if (!rec) { await this.s.put(bucket, pending); return {status: 'invalid'}; }
    delete pending[nonce];
    await this.s.put(bucket, pending);
    if (!approve) return {status: 'denied'};
    if (!/^[a-f0-9]{64}$/.test(expectedSha256 || '')) return {status: 'invalid'};
    if (!eqHex(passphraseSha256, expectedSha256)) {
      lock.fails += 1;
      if (lock.fails >= MAX_FAILS) lock.until = t + LOCK_MS;
      await this.s.put('lock', lock);
      return {status: 'bad_passphrase', remaining: Math.max(0, MAX_FAILS - lock.fails)};
    }
    await this.s.put('lock', {fails: 0, until: 0});
    return {status: 'ok', auth: rec.auth};
  }
}
