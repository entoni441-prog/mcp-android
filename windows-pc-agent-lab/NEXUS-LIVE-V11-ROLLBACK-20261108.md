# NEXUS LIVE v11 — pre-release rollback anchor

Checked 2026-11-08 via connected Cloudflare API, script `nexus-gateway`.

- Live deployment ID: `3dc9ebd7-2cb8-44a9-9673-5a084481f3ae`
- Exact deployed version ID: `8282af73-d76e-41e3-ae83-f5ea6e4608f0` (100% traffic)
- Deployment created: `2026-11-08T12:15:39.509237Z`
- GET Worker script content/v2 returns a multipart response with a **random boundary on every request**; its raw text SHA-256 is not stable and MUST NOT be used as an artifact-integrity gate. Verified twice independently: `index.js` SHA-256 `79952ba9d7c000059bad4c32d4ff1241f0d9b70b3f7c77b71b1ef7a545a28fdd` (318283 chars), `index.js.map` SHA-256 `fd25311987c267834b215f0781cc1c7e89af058482c1fe49f0df2ebb727d8f84` (450720 chars).
- Current published bundle includes `ui://nexus/live-view-v11.html`, 45 public tools, and older consent list filter; not the same as the local repository snapshot. Uploaded source is a two-part module (`index.js`, `index.js.map`) with Cloudflare compatibility date `2026-10-01`, `nodejs_compat`, and four bindings (Durable Object `CONSENT_GUARD`, KV `OAUTH_KV`, two secret_text bindings).
- Rollback method: Cloudflare Worker deployment choosing this exact pre-existing version at 100% traffic. Verify auth, /health, /owner-pub, Live v11 and NEXUS tunnel after rollback. Do not change/clear secrets, KV or Durable Objects.
- This is a **rollback anchor**, not evidence of a completed production update. No NEXUS reboot or security changes at this checkpoint.
