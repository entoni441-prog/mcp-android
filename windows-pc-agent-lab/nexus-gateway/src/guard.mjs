import {DurableObject} from 'cloudflare:workers';
import {GuardCore} from './guard-core.mjs';

/** Single-instance consent guard (idFromName('owner')). RPC methods: issue, attempt. */
export class ConsentGuard extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.core = new GuardCore(ctx.storage); }
  issue(auth) { return this.core.issue(auth); }
  attempt(args) { return this.core.attempt(args); }
}
