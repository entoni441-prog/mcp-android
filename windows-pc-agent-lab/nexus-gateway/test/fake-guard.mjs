import {GuardCore} from '../src/guard-core.mjs';

// Durable Object stand-in: real GuardCore, calls serialized like a DO instance.
export function fakeGuardNamespace(now) {
  const store = new Map();
  const core = new GuardCore({get: async k => store.get(k), put: async (k, v) => { store.set(k, structuredClone(v)); }, delete: async k => { store.delete(k); }}, now);
  let chain = Promise.resolve();
  const serial = fn => (...a) => (chain = chain.then(() => fn(...a), () => fn(...a)));
  const stub = {issue: serial(x => core.issue(x)), attempt: serial(x => core.attempt(x)),
    issueWidget: serial(x => core.issueWidget(x)), attemptWidget: serial(x => core.attemptWidget(x))};
  return {store, ns: {idFromName: n => n, get: id => { if (id !== 'owner') throw Error('unexpected id'); return stub; }}};
}
