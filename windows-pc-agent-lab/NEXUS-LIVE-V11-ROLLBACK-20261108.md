# NEXUS LIVE v11 — pre-release rollback anchor

Checked 2026-11-08 via connected Cloudflare API, script `nexus-gateway`.

- Live deployment ID: `3dc9ebd7-2cb8-44a9-9673-5a084481f3ae`
- Exact deployed version ID: `8282af73-d76e-41e3-ae83-f5ea6e4608f0` (100% traffic)
- Deployment created: `2026-11-08T12:15:39.509237Z`
- GET Worker script content/v2: multipart response length 769436 UTF-16 JS characters; SHA-256 on UTF-8 response text `2033a02d04d020c51a239fa201c04dd2c79913d363fe257fdf2f27bc88e75672`
- Current published bundle includes `ui://nexus/live-view-v11.html`, 45 public tools, and older consent list filter; not the same as the local repository snapshot. Uploaded source is a two-part module (`index.js`, `index.js.map`) with Cloudflare compatibility date `2026-10-01`, `nodejs_compat`, and four bindings (Durable Object `CONSENT_GUARD`, KV `OAUTH_KV`, two secret_text bindings).
- Rollback method: Cloudflare Worker deployment choosing this exact pre-existing version at 100% traffic. Verify auth, /health, /owner-pub, Live v11 and NEXUS tunnel after rollback. Do not change/clear secrets, KV or Durable Objects.
- This is a **rollback anchor**, not evidence of a completed production update. No NEXUS reboot or security changes at this checkpoint.
