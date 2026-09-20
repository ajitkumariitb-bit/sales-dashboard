# Procurement at crm.blissandbirch.co.in

The CRM now has a **Procurement & Packing** navigation entry at `/procurement`. Its operational workspace is mounted at `/procurement/workspace/`. Existing sales, lead recovery, Shopify recovery-order sync, Supabase tables and Google Sheet workflows are unchanged.

Set the server-only environment variable:

```
PROCUREMENT_ENGINE_URL=https://YOUR-PERSISTENT-ENGINE-HOST
```

This must be the engine origin, without a path, credentials or query string. Production requires HTTPS. Missing configuration returns an explicit setup state; there is no mock online inventory and no localhost fallback in production.

For a development preview only, run the procurement demo separately on port 8765 and set `PROCUREMENT_ENGINE_URL=http://127.0.0.1:8765` in the Next development process environment. Do not add it to Vercel production.

The engine code is in the current procurement task's `outputs/procurement-engine`. It uses its own authentication and four-role authorization. The CRM's user-ID cookie does not grant procurement access, and is never forwarded to the engine. Operational cookies are scoped to `/procurement/workspace`. The workspace route bypasses the CRM's cookie middleware only because every sensitive engine endpoint enforces the engine session itself. This also allows a Packing employee to bookmark the workspace directly without access to CRM lead records.

The inspected CRM currently resolves a session from an unsigned user-ID cookie. Consequently this change deliberately does not add single sign-on or trust that cookie for inventory permissions. A shared, verified session/identity-provider migration is required before safely unifying logins.

## Deployment prerequisites

The live site was confirmed to use Next.js on Vercel, behind Cloudflare. The local folder has no `.vercel` link or Git remote. No production deployment has been made by this task.

Vercel's function filesystem cannot host the engine's durable SQLite database. Host the supplied container on a persistent, single-instance service with its runtime volume and a read-only catalog mount, or migrate the operational store to managed Postgres before choosing a serverless backend. Do not copy the demo database into a live deployment. [Vercel SQLite guidance](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)

After the backend is available:

1. Set `PROCUREMENT_ENGINE_URL` on the existing CRM project and redeploy the reviewed source changes.
2. Set the engine's Shopify secret and exact shop domain through its hosting secret manager.
3. Shopify webhook URL on the existing CRM domain: `https://crm.blissandbirch.co.in/procurement/workspace/webhooks/shopify`.
4. Create named engine accounts, verify canonical mappings and opening stock, and connect the Catalog Intelligence outbox consumer.
5. Exercise the acceptance scenario on test data, then use the live workspace. Existing sales sync does not allocate physical stock and should not be repurposed without its full order lines and identity mapping.

No DNS changes are needed for the new section. Proxy traffic is limited to the configured engine origin, supports only GET/POST, does not forward CRM authorization or service credentials, and retains the engine's CSRF, HMAC and idempotency checks. Phone photos are compressed by the engine frontend before upload to fit the proxy's 4 MB request limit.
